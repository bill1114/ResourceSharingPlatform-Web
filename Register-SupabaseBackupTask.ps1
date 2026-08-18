# Register-SupabaseBackupTask.ps1 - One-time setup: registers a Windows Task
# Scheduler job that runs Backup-Supabase.ps1 every Sunday at 02:30 (30 minutes
# after the old .NET app's ResourceSharingPlatform-Backup task, so they don't
# contend for disk/network at the same instant), as NT AUTHORITY\SYSTEM.
#
# BEFORE running this script, set these 3 environment variables at MACHINE
# scope (so SYSTEM can read them too - a SYSTEM-run task does not inherit your
# interactive user's per-user env vars). Run these yourself, in your own
# elevated PowerShell window - the actual values never need to be shared with
# Claude:
#
#   [Environment]::SetEnvironmentVariable('SUPABASE_URL', 'https://yodbgmupyvwfxdzikmoa.supabase.co', 'Machine')
#   [Environment]::SetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY', '<your service_role key>', 'Machine')
#   [Environment]::SetEnvironmentVariable('SUPABASE_DB_URL', 'postgresql://postgres:<db password>@db.yodbgmupyvwfxdzikmoa.supabase.co:5432/postgres', 'Machine')
#
# The service_role key and DB password are in Supabase: Project Settings ->
# API Keys (secret key) and Project Settings -> Database (connection string /
# reset password). After setting machine-level env vars, close and reopen any
# elevated PowerShell window before running this script, so it picks up the
# new values.
#
# Run via: powershell -ExecutionPolicy Bypass -File Register-SupabaseBackupTask.ps1

$ErrorActionPreference = 'Stop'

$TaskName = 'ResourceSharingPlatform-Web-Backup'
$ScriptPath = Join-Path $PSScriptRoot 'Backup-Supabase.ps1'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host 'ERROR: 請用系統管理員權限的 PowerShell 執行這個腳本。' -ForegroundColor Red
    exit 1
}

$missing = @('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL') |
    Where-Object { -not [Environment]::GetEnvironmentVariable($_, 'Machine') }
if ($missing.Count -gt 0) {
    Write-Host ("ERROR: 尚未設定這些機器層級環境變數：{0}" -f ($missing -join ', ')) -ForegroundColor Red
    Write-Host '請先參考本檔案開頭註解，自己在有系統管理員權限的 PowerShell 視窗設定好，再重新執行這個腳本。' -ForegroundColor Yellow
    exit 1
}

$actionArgs = "-NoProfile -ExecutionPolicy Bypass -File ""$ScriptPath"""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArgs
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 02:30
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$description = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::UTF8.GetBytes(
    '每週備份 Supabase 資料庫（pg_dump）與 items/ai-stockin Storage 圖片，保留最近 14 份，存到 D:\SupabaseBackups'
))

$registerArgs = @{
    TaskName    = $TaskName
    Action      = $action
    Trigger     = $trigger
    Principal   = $principal
    Settings    = $settings
    Description = $description
    Force       = $true
}
Register-ScheduledTask @registerArgs | Out-Null

Write-Host "排程 '$TaskName' 已建立：每週日 02:30 以 SYSTEM 身分執行 Backup-Supabase.ps1" -ForegroundColor Green
Write-Host "立即測試：Start-ScheduledTask -TaskName $TaskName" -ForegroundColor Cyan
Write-Host "查看上次執行結果：Get-ScheduledTaskInfo -TaskName $TaskName" -ForegroundColor Cyan

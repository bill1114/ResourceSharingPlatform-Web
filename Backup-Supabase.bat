@echo off
REM Backup-Supabase.bat - Manually trigger an immediate backup (same script the
REM weekly schedule runs). Requires SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
REM SUPABASE_DB_URL to already be set as environment variables (see
REM Register-SupabaseBackupTask.ps1's header comment for how to set them).
REM Piped into PowerShell instead of run with -File so it works even when a
REM machine/user policy (e.g. AllSigned) blocks execution of unsigned .ps1
REM files - same reasoning as the old app's Start.bat/Stop.bat.

setlocal
set SCRIPT_DIR=%~dp0

powershell -NoProfile -Command "Get-Content -Raw -Encoding UTF8 '%SCRIPT_DIR%Backup-Supabase.ps1' | Invoke-Expression"

echo.
pause

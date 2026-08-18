# Backup-Supabase.ps1 - Weekly backup of the Supabase Postgres database and the
# `items`/`ai-stockin` Storage buckets, for the React+Supabase rewrite.
# Mirrors the retention/scheduling spirit of the old .NET app's Backup.ps1
# (weekly, keep newest 14 of each type), adapted for a cloud-hosted DB with no
# Windows-integrated auth: credentials come from environment variables set
# locally by the operator, never typed into chat or committed to git.
#
# Required environment variables (set once, machine-level, see
# Register-SupabaseBackupTask.ps1's instructions - never pass these as script
# arguments, which would land in process-list/shell history):
#   SUPABASE_URL               e.g. https://yodbgmupyvwfxdzikmoa.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY  Storage downloads need this to bypass RLS and see
#                              every file, not just what an anon/authenticated
#                              caller could read
#   SUPABASE_DB_URL            Full Postgres connection string with password,
#                              e.g. postgresql://postgres:PW@db.xxxx.supabase.co:5432/postgres
#                              (percent-encode any special characters in the password)
#
# Run manually via: powershell -ExecutionPolicy Bypass -File Backup-Supabase.ps1
# Run automatically by the "ResourceSharingPlatform-Web-Backup" scheduled task.

$ErrorActionPreference = 'Continue'

$RootDir    = $PSScriptRoot
$BackupDir  = 'D:\SupabaseBackups'   # deliberately OUTSIDE the git repo - these
                                      # dumps contain real recipient/donor PII
$RetainCount = 14
$LogFile    = Join-Path $BackupDir 'backup.log'
$Timestamp  = Get-Date -Format 'yyyyMMdd_HHmmss'

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    [System.IO.File]::AppendAllText($LogFile, $line + [Environment]::NewLine)
    Write-Host $line
}

Write-Log "=== Backup run started ==="

$dbUrl = $env:SUPABASE_DB_URL
$projectUrl = $env:SUPABASE_URL
$serviceKey = $env:SUPABASE_SERVICE_ROLE_KEY

if (-not $dbUrl -or -not $projectUrl -or -not $serviceKey) {
    Write-Log "ERROR: 缺少必要的環境變數（SUPABASE_DB_URL / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY），中止備份。"
    exit 1
}

# --- Step 1: Database dump (schema + data) via the Supabase CLI's bundled pg_dump ---
try {
    $dbFile = Join-Path $BackupDir "db_$Timestamp.sql"
    Push-Location $RootDir
    npx supabase db dump --db-url $dbUrl --file $dbFile 2>&1 | Out-Null
    Pop-Location

    if (-not (Test-Path $dbFile) -or (Get-Item $dbFile).Length -le 0) {
        throw "dump 檔案沒有產生或是空的"
    }
    Write-Log "資料庫備份完成：$dbFile ($([math]::Round((Get-Item $dbFile).Length / 1MB, 2)) MB)"
} catch {
    Write-Log "ERROR: 資料庫備份失敗 - $($_.Exception.Message)"
}

# --- Step 2: Storage buckets (items, ai-stockin) - recursive list + download, zipped ---
function Get-StorageFilesRecursive {
    param([string]$Bucket, [string]$Prefix = '')
    $uri = "$projectUrl/storage/v1/object/list/$Bucket"
    $body = @{ prefix = $Prefix; limit = 1000 } | ConvertTo-Json
    $headers = @{ Authorization = "Bearer $serviceKey"; apikey = $serviceKey; 'Content-Type' = 'application/json' }
    $entries = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body
    $files = @()
    foreach ($entry in $entries) {
        $path = if ($Prefix) { "$Prefix/$($entry.name)" } else { $entry.name }
        if ($null -eq $entry.id) {
            # No object id = a "folder" placeholder; recurse into it.
            $files += Get-StorageFilesRecursive -Bucket $Bucket -Prefix $path
        } else {
            $files += $path
        }
    }
    return $files
}

try {
    $stagingDir = Join-Path $env:TEMP "supabase-storage-backup-$Timestamp"
    New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
    $headers = @{ Authorization = "Bearer $serviceKey"; apikey = $serviceKey }
    $totalFiles = 0

    foreach ($bucket in @('items', 'ai-stockin')) {
        $bucketDir = Join-Path $stagingDir $bucket
        New-Item -ItemType Directory -Path $bucketDir -Force | Out-Null
        $files = Get-StorageFilesRecursive -Bucket $bucket
        foreach ($file in $files) {
            $destPath = Join-Path $bucketDir $file
            $destDir = Split-Path $destPath -Parent
            if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
            $downloadUri = "$projectUrl/storage/v1/object/$bucket/$file"
            Invoke-WebRequest -Uri $downloadUri -Headers $headers -OutFile $destPath -ErrorAction Stop
            $totalFiles++
        }
    }

    $zipFile = Join-Path $BackupDir "storage_$Timestamp.zip"
    Compress-Archive -Path (Join-Path $stagingDir '*') -DestinationPath $zipFile -CompressionLevel Optimal
    Remove-Item -Path $stagingDir -Recurse -Force -ErrorAction SilentlyContinue

    if (-not (Test-Path $zipFile) -or (Get-Item $zipFile).Length -le 0) {
        throw "zip 檔案沒有產生或是空的"
    }
    Write-Log "圖片備份完成：$zipFile（共 $totalFiles 個檔案，$([math]::Round((Get-Item $zipFile).Length / 1MB, 2)) MB）"
} catch {
    Write-Log "ERROR: 圖片備份失敗 - $($_.Exception.Message)"
}

# --- Step 3: Retention cleanup (keep newest N of each type) ---
function Remove-OldBackups {
    param([string]$Filter)
    $files = Get-ChildItem -Path $BackupDir -Filter $Filter -File | Sort-Object LastWriteTime -Descending
    if ($files.Count -le $RetainCount) { return }
    $toDelete = $files | Select-Object -Skip $RetainCount
    foreach ($f in $toDelete) {
        try {
            Remove-Item $f.FullName -Force -ErrorAction Stop
            Write-Log "保留策略：刪除舊檔 $($f.Name)"
        } catch {
            Write-Log "ERROR: 保留策略無法刪除 $($f.Name) - $($_.Exception.Message)"
        }
    }
}

try {
    Remove-OldBackups -Filter 'db_*.sql'
    Remove-OldBackups -Filter 'storage_*.zip'
} catch {
    Write-Log "ERROR: 保留策略執行失敗 - $($_.Exception.Message)"
}

Write-Log "=== Backup run finished ==="

@echo off
REM Register-SupabaseBackupTask.bat - One-time setup for the weekly Supabase
REM backup schedule. Must be run from an elevated (Administrator) Command
REM Prompt: right-click this file and choose "Run as administrator".
REM
REM Piped into PowerShell instead of run with -File so it works even when a
REM machine/user policy (e.g. AllSigned) blocks execution of unsigned .ps1
REM files. -Encoding UTF8 avoids the Chinese task description getting
REM misread via the console's legacy codepage.

setlocal
set SCRIPT_DIR=%~dp0

powershell -NoProfile -Command "$RootDir = '%SCRIPT_DIR%'; Get-Content -Raw -Encoding UTF8 '%SCRIPT_DIR%Register-SupabaseBackupTask.ps1' | Invoke-Expression"

echo.
pause

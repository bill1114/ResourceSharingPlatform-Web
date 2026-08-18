# Supabase 資料庫與圖片備份筆記

`ResourceSharingPlatform-Web`（React + Supabase 版）的每週自動備份設定。跟舊 .NET 版的備份（`Markdown/BackupPlan.md` in `ResourceSharingPlatform`）概念一樣：每週一次、保留最近 14 份，但因為資料庫改在雲端（Supabase），做法不同。

## 目前設定

| 項目 | 值 |
|---|---|
| 備份腳本 | `Backup-Supabase.ps1`（repo 根目錄，已納入版控） |
| 排程工作 | Windows工作排程器「`ResourceSharingPlatform-Web-Backup`」 |
| 排程時間 | 每週日凌晨 02:30（跟舊版 .NET 系統的備份錯開 30 分鐘） |
| 執行身分 | `NT AUTHORITY\SYSTEM`（不需存密碼，機器沒登入也能跑） |
| 備份內容 | Postgres 資料庫全量匯出（`supabase db dump`，schema + 資料）＋ `items`／`ai-stockin` 兩個 Storage bucket 的所有檔案（壓成 zip） |
| 存放位置 | `D:\SupabaseBackups\`（**刻意放在 repo 資料夾之外**——備份內容含真實的領用人/捐贈者姓名、聯絡方式等個資，不能進到版控，更不能進到目前是 Public 的 GitHub repo） |
| 保留份數 | 最近 14 份（`.sql` 與 `.zip` 分開各留 14 份，超過自動刪除最舊的） |
| 執行紀錄 | `D:\SupabaseBackups\backup.log`（每次執行都會附加，不會覆蓋） |

備份檔名格式：`db_yyyyMMdd_HHmmss.sql`、`storage_yyyyMMdd_HHmmss.zip`。

## 一次性設定：機器層級環境變數（密碼／金鑰不會經過 Claude）

`Backup-Supabase.ps1` 需要 3 個環境變數才能連上 Supabase，這些是機密資訊，**請自己在有系統管理員權限的 PowerShell 視窗設定**，不要貼給 Claude：

```powershell
[Environment]::SetEnvironmentVariable('SUPABASE_URL', 'https://yodbgmupyvwfxdzikmoa.supabase.co', 'Machine')
[Environment]::SetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY', '<Project Settings → API Keys 裡的 secret key>', 'Machine')
[Environment]::SetEnvironmentVariable('SUPABASE_DB_URL', 'postgresql://postgres:<資料庫密碼>@db.yodbgmupyvwfxdzikmoa.supabase.co:5432/postgres', 'Machine')
```

- `SUPABASE_SERVICE_ROLE_KEY`：Supabase 後台 → Project Settings → API Keys → Secret keys（就是之前提醒過不要貼給 Claude 的那把）
- `SUPABASE_DB_URL` 裡的密碼：就是當初建立 Supabase 專案時您自己設定、要記得的那組資料庫密碼；如果忘記了可以到 Project Settings → Database → Reset database password 重設
- 設定為 `Machine` 層級是因為排程用 SYSTEM 身分執行，不會讀到一般使用者層級（User）的環境變數
- 設定好之後，**關掉再重新打開**一個新的系統管理員 PowerShell 視窗，環境變數才會生效

## 註冊排程（一次性）

環境變數設定好之後，**用系統管理員權限**執行：

```bash
Register-SupabaseBackupTask.bat
```

（可重複執行，會覆蓋舊的排程定義）

## 手動立即執行一次備份

雙擊 `Backup-Supabase.bat`（環境變數要先設定好），或用 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File Backup-Supabase.ps1
```

## 確認排程是否正常執行

```powershell
Get-ScheduledTaskInfo -TaskName "ResourceSharingPlatform-Web-Backup"
Start-ScheduledTask -TaskName "ResourceSharingPlatform-Web-Backup"
```

或直接看 `D:\SupabaseBackups\backup.log` 最後幾行。

## 還原方式

### 還原資料庫

```powershell
# 用 psql 或 Supabase SQL Editor 執行備份檔內容即可還原到另一個（測試用）Supabase 專案。
# 不建議直接對正式專案 "覆蓋還原"——Postgres 沒有像 SQL Server RESTORE ... WITH REPLACE 那種
# 一鍵整庫覆蓋語法，dump 檔本質是一堆 CREATE/INSERT 語句，要覆蓋正式庫請先手動清空/評估風險。
psql "postgresql://postgres:<密碼>@db.yodbgmupyvwfxdzikmoa.supabase.co:5432/postgres" -f db_20260813_020000.sql
```

### 還原圖片

把對應時間點的 `storage_yyyyMMdd_HHmmss.zip` 解壓縮，裡面是 `items/`、`ai-stockin/` 兩個資料夾，用 Supabase Dashboard 的 Storage 頁面手動上傳回對應 bucket，或用 Supabase CLI／API 批次上傳。

## 注意事項

- **這個 repo（`ResourceSharingPlatform-Web`）目前是 Public**，所以備份資料絕對不能放進 repo 資料夾或推上 GitHub（含個資，且是公開的）——這是選 `D:\SupabaseBackups\`（repo 外）而不是像舊系統一樣放在 repo 資料夾裡的原因。
- Supabase 付費方案（Pro 以上）本身有內建每日自動備份/PITR；如果之後升級付費方案，這支腳本可以當作額外一層保險，不衝突。
- 資料庫匯出與圖片備份各自獨立 try/catch，其中一個失敗不影響另一個；任何失敗都會寫進 `backup.log`，需要定期人工檢查（目前沒有失敗通知機制）。
- `supabase db dump` 需要能連到網際網路存取 Supabase，跟舊系統的本機 SQL Server 備份不同，執行時機器要有網路。

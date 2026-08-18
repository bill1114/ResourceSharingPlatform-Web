// Client-side "匯出 Excel" — builds a real .xlsx from already-loaded, already
// filtered rows (no server round-trip). Replaces the old .NET ExcelExportHelper.
// We only ever WRITE workbooks from our own data (never parse uploaded files),
// so SheetJS's parse-path CVEs don't apply here.
import * as XLSX from 'xlsx'

export type ExcelColumn<T> = { header: string; value: (row: T) => string | number | null | undefined }

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`
}

export function exportToExcel<T>(baseName: string, sheetName: string, columns: ExcelColumn<T>[], rows: T[]): void {
  const aoa: (string | number)[][] = [
    columns.map((c) => c.header),
    ...rows.map((r) => columns.map((c) => c.value(r) ?? '')),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(10, c.header.length * 2 + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, `${baseName}_${stamp()}.xlsx`)
}

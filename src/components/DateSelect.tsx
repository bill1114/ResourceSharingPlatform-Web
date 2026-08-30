// 年 / 月 / 日 三個下拉的日期選擇，取代原生 <input type="date">。
// 原生日期欄在中文 Chrome 會出現日曆彈窗，底部的「今天」按鈕常被誤認為「確認」，
// 導致使用者按了「今天」把日期蓋掉、需要再選一次。改用純下拉就沒有這個問題，
// 也順便把年份限死在合理範圍（避免打成 20000）。
// 值格式與原本一致：'YYYY-MM-DD'（未選完整回傳空字串）。
import { useMemo } from 'react'

function daysInMonth(year: number, month: number): number {
  if (!year || !month) return 31
  return new Date(year, month, 0).getDate()
}

export function DateSelect({
  value,
  onChange,
  fromYear,
  toYear,
}: {
  value: string
  onChange: (v: string) => void
  fromYear?: number
  toYear?: number
}) {
  const thisYear = new Date().getFullYear()
  const minY = fromYear ?? thisYear - 1
  const maxY = toYear ?? thisYear + 10

  const [y, m, d] = useMemo(() => {
    const mParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '')
    return mParts ? [Number(mParts[1]), Number(mParts[2]), Number(mParts[3])] : [0, 0, 0]
  }, [value])

  const years = useMemo(() => {
    const arr: number[] = []
    for (let i = minY; i <= maxY; i++) arr.push(i)
    return arr
  }, [minY, maxY])

  function emit(ny: number, nm: number, nd: number) {
    if (ny && nm && nd) {
      const dd = Math.min(nd, daysInMonth(ny, nm))
      onChange(`${ny}-${String(nm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`)
    } else {
      onChange('')
    }
  }

  return (
    <div className="d-flex gap-2">
      <select className="form-select" value={y || ''} onChange={(e) => emit(Number(e.target.value), m, d)} aria-label="年">
        <option value="">年</option>
        {years.map((yy) => (
          <option key={yy} value={yy}>{yy} 年</option>
        ))}
      </select>
      <select className="form-select" value={m || ''} onChange={(e) => emit(y, Number(e.target.value), d)} aria-label="月">
        <option value="">月</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => (
          <option key={mm} value={mm}>{mm} 月</option>
        ))}
      </select>
      <select className="form-select" value={d || ''} onChange={(e) => emit(y, m, Number(e.target.value))} aria-label="日">
        <option value="">日</option>
        {Array.from({ length: daysInMonth(y, m) }, (_, i) => i + 1).map((dd) => (
          <option key={dd} value={dd}>{dd} 日</option>
        ))}
      </select>
    </div>
  )
}

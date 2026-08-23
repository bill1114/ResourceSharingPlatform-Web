// 領取分析頁的「Excel 式篩選」彈窗。只有 RecipientAnalysis.tsx 會 import。
//
// 兩步驟：先選篩選類別（使用人／身分別／鄉鎮別／物資品項），再從該類別
// 「資料裡實際出現過的值」勾選要保留哪些 —— 跟 Excel 的欄位篩選一樣，
// 選項不是寫死的清單，而是從目前的資料推出來的。
//
// 語意：同一個類別內的多個值是 OR（任一符合即可），不同類別之間是 AND。
// 這也跟 Excel 一樣：兩個欄位各自篩，結果是交集。
import { useMemo, useState } from 'react'
import {
  AllFilterFields,
  FilterFieldIcons,
  FilterFieldLabels,
  type AnalysisFilter,
  type FilterField,
  type FilterOption,
} from '../lib/analysisFilters'

export function AnalysisFilterModal({
  /** 每個類別可選的值（已由頁面依目前資料算好，含筆數） */
  optionsOf,
  /** 編輯既有條件時帶進來；新增時為 null */
  editing,
  onCancel,
  onApply,
}: {
  optionsOf: (field: FilterField) => FilterOption[]
  editing: AnalysisFilter | null
  onCancel: () => void
  onApply: (filter: AnalysisFilter) => void
}) {
  const [field, setField] = useState<FilterField | null>(editing?.field ?? null)
  const [selected, setSelected] = useState<Set<string>>(new Set(editing?.values ?? []))
  const [keyword, setKeyword] = useState('')

  const options = useMemo(() => (field ? optionsOf(field) : []), [field, optionsOf])
  const visible = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    return k ? options.filter((o) => o.label.toLowerCase().includes(k)) : options
  }, [options, keyword])

  // 換類別時舊的勾選一定失效（值域不一樣），直接清掉。
  function chooseField(next: FilterField) {
    setField(next)
    setKeyword('')
    setSelected(editing?.field === next ? new Set(editing.values) : new Set())
  }

  function toggle(value: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  // 全選／清除只作用在「目前搜尋結果看得到的」那些選項，跟 Excel 一致。
  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      visible.forEach((o) => next.add(o.value))
      return next
    })
  }
  function clearVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      visible.forEach((o) => next.delete(o.value))
      return next
    })
  }

  return (
    <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              <i className="bi bi-funnel" /> {editing ? '編輯篩選條件' : '新增篩選條件'}
            </h5>
            <button type="button" className="btn-close" onClick={onCancel} />
          </div>

          <div className="modal-body">
            {/* ---------- 步驟一：選類別 ---------- */}
            <div className="mb-3">
              <label className="form-label">
                <span className="badge bg-dark me-1">1</span> 選擇篩選類別
              </label>
              <div className="d-flex flex-wrap gap-2">
                {AllFilterFields.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`btn ${field === f ? 'btn-dark' : 'btn-outline-dark'}`}
                    onClick={() => chooseField(f)}
                  >
                    <i className={`bi ${FilterFieldIcons[f]}`} /> {FilterFieldLabels[f]}
                    <span className="badge bg-secondary ms-2">{optionsOf(f).length}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ---------- 步驟二：勾選內容 ---------- */}
            <div>
              <label className="form-label">
                <span className="badge bg-dark me-1">2</span> 勾選要保留的內容
                {field && <span className="text-muted small ms-2">已選 {selected.size} 項</span>}
              </label>

              {!field ? (
                <div className="alert alert-secondary mb-0">請先在上面選一個篩選類別。</div>
              ) : options.length === 0 ? (
                <div className="alert alert-warning mb-0">目前的資料裡沒有這個類別的值。</div>
              ) : (
                <>
                  <div className="d-flex gap-2 mb-2">
                    <input
                      className="form-control"
                      placeholder={`搜尋${FilterFieldLabels[field]}`}
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                    />
                    <button type="button" className="btn btn-outline-secondary text-nowrap" onClick={selectAllVisible}>
                      全選
                    </button>
                    <button type="button" className="btn btn-outline-secondary text-nowrap" onClick={clearVisible}>
                      清除
                    </button>
                  </div>

                  <div className="border rounded p-2" style={{ maxHeight: 300, overflowY: 'auto' }}>
                    {visible.length === 0 ? (
                      <div className="text-muted text-center py-3">沒有符合搜尋的項目</div>
                    ) : (
                      visible.map((o) => (
                        <div className="form-check d-flex align-items-center" key={o.value}>
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id={`opt-${field}-${o.value}`}
                            checked={selected.has(o.value)}
                            onChange={() => toggle(o.value)}
                          />
                          <label className="form-check-label ms-2 flex-grow-1" htmlFor={`opt-${field}-${o.value}`}>
                            {o.label}
                          </label>
                          <span className="badge bg-light text-dark border">{o.count} 筆</span>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!field || selected.size === 0}
              onClick={() => field && onApply({ field, values: [...selected] })}
            >
              <i className="bi bi-check-lg" /> 套用篩選
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


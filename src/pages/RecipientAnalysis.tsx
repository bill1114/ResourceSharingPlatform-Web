// 領取分析 — 以物資為核心的樞紐（pivot）分析。
//
// 兩個維度：
//   分析角度（主軸）= 第一個篩選條件的類別。一列一個該類別的值。
//                     沒有任何條件時預設「物資品項」（＝從物資的角度出發）。
//   明細維度（次軸）= 每一列展開後看到的分佈，預設「物資品項」。
//
// 於是同一頁可以回答不同問題，差別只在第一個條件選什麼：
//   第一條件＝使用人   → 一列一位領用人，明細是「他領了哪些物資」
//   第一條件＝鄉鎮別   → 一列一個鄉鎮，明細是「該鄉鎮領走哪些物資」
//   第一條件＝物資品項 → 一列一項物資，明細預設改看「哪些鄉鎮領走」
//
// 資料來源與權限的說明見 Markdown/Feature-RecipientAnalysis.md §三：
// 直接讀 supply_outbound_log 明細（RLS 一樣限縮據點），已取消的一律排除。
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { recipientIdentityDisplayName } from '../lib/yunlinDistricts'
import { AnalysisFilterModal } from '../components/AnalysisFilterModal'
import {
  AllFilterFields,
  EMPTY_VALUE,
  FilterFieldIcons,
  FilterFieldLabels,
  FilterFields,
  type AnalysisFilter,
  type FilterField,
  type FilterOption,
} from '../lib/analysisFilters'
import type { SupplyItem, SupplyOutboundLog } from '../types/db'

/** 一列的明細分佈：某個次軸的值 + 次數/件數。 */
interface DetailRow {
  value: string
  label: string
  pickupCount: number
  quantity: number
}

/** 主軸的一列。 */
interface GroupRow {
  value: string
  label: string
  pickupCount: number
  quantity: number
  recipientCount: number
  details: DetailRow[]
}

/** 摺疊時最多先露幾個明細標籤。 */
const TOP_N = 5

export function RecipientAnalysis() {
  const [logs, setLogs] = useState<SupplyOutboundLog[]>([])
  const [items, setItems] = useState<SupplyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<AnalysisFilter[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<AnalysisFilter | null>(null)
  const [detailOverride, setDetailOverride] = useState<FilterField | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [logRes, itemRes] = await Promise.all([
        // 分析要看全部資料，不能像紀錄頁那樣只抓最近 100 筆。
        supabase.from('supply_outbound_log').select('*').order('outbound_time', { ascending: false }).limit(5000),
        supabase.from('supply_item').select('id, item_name, specification, unit'),
      ])
      setLogs((logRes.data ?? []) as SupplyOutboundLog[])
      setItems((itemRes.data ?? []) as SupplyItem[])
      setLoading(false)
    }
    void load()
  }, [])

  const itemNameOf = useCallback(
    (id: number) => items.find((i) => i.id === id)?.item_name ?? `物資 #${id}`,
    [items]
  )

  // 已取消的不列入任何統計。
  const activeLogs = useMemo(() => logs.filter((l) => !l.is_cancelled), [logs])

  const valueOf = useCallback(
    (log: SupplyOutboundLog, field: FilterField): string => {
      switch (field) {
        case FilterFields.Recipient:
          return log.recipient_name || EMPTY_VALUE
        case FilterFields.Identity:
          return log.recipient_identity || EMPTY_VALUE
        case FilterFields.District:
          return log.recipient_district || EMPTY_VALUE
        case FilterFields.Item:
          return itemNameOf(log.supply_item_id)
      }
    },
    [itemNameOf]
  )

  const labelOf = useCallback((field: FilterField, value: string): string => {
    if (value === EMPTY_VALUE) return '（未填）'
    return field === FilterFields.Identity ? recipientIdentityDisplayName(value) : value
  }, [])

  // ---- 兩個維度 -------------------------------------------------------------
  // 主軸：第一個篩選條件的類別。沒有條件時預設物資品項。
  const primaryField: FilterField = filters[0]?.field ?? FilterFields.Item
  // 次軸：預設物資品項（從物資的角度出發）；主軸本身已經是物資品項時改看鄉鎮別，
  // 否則展開會變成「米的明細是米」這種沒有資訊量的東西。使用者可自行覆寫。
  const defaultDetailField: FilterField =
    primaryField === FilterFields.Item ? FilterFields.District : FilterFields.Item
  const detailField: FilterField =
    detailOverride && detailOverride !== primaryField ? detailOverride : defaultDetailField

  // 彈窗選項：用「套用其他條件之後」的資料來算，跟 Excel 一樣。
  const optionsOf = useCallback(
    (field: FilterField): FilterOption[] => {
      const others = filters.filter((f) => f.field !== field)
      const scope = activeLogs.filter((log) => others.every((f) => f.values.includes(valueOf(log, f.field))))
      const counts = new Map<string, number>()
      for (const log of scope) {
        const v = valueOf(log, field)
        counts.set(v, (counts.get(v) ?? 0) + 1)
      }
      return [...counts.entries()]
        .map(([value, count]) => ({ value, label: labelOf(field, value), count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hant'))
    },
    [activeLogs, filters, valueOf, labelOf]
  )

  // 同類別內 OR、不同類別間 AND。
  const filteredLogs = useMemo(
    () => activeLogs.filter((log) => filters.every((f) => f.values.includes(valueOf(log, f.field)))),
    [activeLogs, filters, valueOf]
  )

  // ---- 樞紐彙總 -------------------------------------------------------------
  const groups = useMemo<GroupRow[]>(() => {
    const map = new Map<
      string,
      { value: string; pickupCount: number; quantity: number; recipients: Set<string>; details: Map<string, DetailRow> }
    >()
    for (const log of filteredLogs) {
      const gv = valueOf(log, primaryField)
      let g = map.get(gv)
      if (!g) {
        g = { value: gv, pickupCount: 0, quantity: 0, recipients: new Set(), details: new Map() }
        map.set(gv, g)
      }
      g.pickupCount += 1
      g.quantity += log.outbound_quantity
      g.recipients.add(`${log.recipient_name}||${log.recipient_contact ?? ''}`)

      const dv = valueOf(log, detailField)
      let d = g.details.get(dv)
      if (!d) {
        d = { value: dv, label: labelOf(detailField, dv), pickupCount: 0, quantity: 0 }
        g.details.set(dv, d)
      }
      d.pickupCount += 1
      d.quantity += log.outbound_quantity
    }
    return [...map.values()]
      .map((g) => ({
        value: g.value,
        label: labelOf(primaryField, g.value),
        pickupCount: g.pickupCount,
        quantity: g.quantity,
        recipientCount: g.recipients.size,
        details: [...g.details.values()].sort((a, b) => b.quantity - a.quantity || b.pickupCount - a.pickupCount),
      }))
      .sort((a, b) => b.quantity - a.quantity || b.pickupCount - a.pickupCount)
  }, [filteredLogs, primaryField, detailField, valueOf, labelOf])

  const totalPickups = groups.reduce((s, g) => s + g.pickupCount, 0)
  const totalQuantity = groups.reduce((s, g) => s + g.quantity, 0)
  const distinctRecipients = useMemo(
    () => new Set(filteredLogs.map((l) => `${l.recipient_name}||${l.recipient_contact ?? ''}`)).size,
    [filteredLogs]
  )
  const distinctItems = useMemo(
    () => new Set(filteredLogs.map((l) => l.supply_item_id)).size,
    [filteredLogs]
  )

  // ---- 條件操作 -------------------------------------------------------------
  function applyFilter(filter: AnalysisFilter) {
    setFilters((prev) => {
      const idx = prev.findIndex((f) => f.field === filter.field)
      if (idx < 0) return [...prev, filter]
      const next = [...prev]
      next[idx] = filter
      return next
    })
    setModalOpen(false)
    setEditing(null)
    setExpanded(new Set())
  }

  function removeFilter(field: FilterField) {
    setFilters((prev) => prev.filter((f) => f.field !== field))
    setExpanded(new Set())
  }

  // 把某個條件搬到第一個 —— 也就是把它設成分析角度。
  function makePrimary(field: FilterField) {
    setFilters((prev) => {
      const target = prev.find((f) => f.field === field)
      if (!target) return prev
      return [target, ...prev.filter((f) => f.field !== field)]
    })
    setExpanded(new Set())
  }

  function toggleExpand(value: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  const detailChoices = AllFilterFields.filter((f) => f !== primaryField)

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">
          <i className="bi bi-graph-up" /> 領取分析
        </h2>
        <button
          className="btn btn-primary"
          onClick={() => {
            setEditing(null)
            setModalOpen(true)
          }}
        >
          <i className="bi bi-funnel" /> 新增篩選條件
        </button>
      </div>

      {/* ---------- 分析角度 ---------- */}
      <div className="card shadow-sm mb-3 border-primary">
        <div className="card-body d-flex flex-wrap align-items-center gap-3">
          <div>
            <div className="text-muted small">分析角度（主軸）</div>
            <div className="fs-5 fw-bold">
              <i className={`bi ${FilterFieldIcons[primaryField]}`} /> {FilterFieldLabels[primaryField]}
            </div>
          </div>
          <i className="bi bi-arrow-right fs-4 text-muted" />
          <div>
            <div className="text-muted small">明細維度</div>
            <select
              className="form-select form-select-sm"
              value={detailField}
              onChange={(e) => setDetailOverride(e.target.value as FilterField)}
            >
              {detailChoices.map((f) => (
                <option key={f} value={f}>
                  {FilterFieldLabels[f]}
                </option>
              ))}
            </select>
          </div>
          <div className="text-muted small flex-grow-1" style={{ minWidth: 260 }}>
            {filters.length === 0 ? (
              <>
                目前沒有篩選條件，預設以<strong>物資品項</strong>為分析角度。
                <br />
                <strong>加入的第一個篩選條件會成為分析角度</strong>；例如第一個選「使用人」，
                下表就會變成一列一位領用人、明細是他領了哪些物資。
              </>
            ) : (
              <>
                分析角度來自<strong>第一個</strong>篩選條件「{FilterFieldLabels[primaryField]}」。
                想換角度可以在下方條件標籤按「設為分析角度」，或直接調整條件順序。
              </>
            )}
          </div>
        </div>
      </div>

      {/* ---------- 生效中的篩選條件 ---------- */}
      <div className="card shadow-sm mb-3">
        <div className="card-header bg-light d-flex justify-content-between align-items-center">
          <span>
            <i className="bi bi-funnel" /> 篩選條件
            {filters.length > 0 && <span className="badge bg-primary ms-2">{filters.length}</span>}
          </span>
          {filters.length > 0 && (
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={() => {
                setFilters([])
                setExpanded(new Set())
              }}
            >
              <i className="bi bi-x-circle" /> 清除全部
            </button>
          )}
        </div>
        <div className="card-body">
          {filters.length === 0 ? (
            <div className="text-muted">
              尚未加入條件。按右上角「新增篩選條件」可依 使用人／身分別／鄉鎮別／物資品項篩選，
              多個條件會同時生效（同類別內是「或」、不同類別之間是「且」）。
            </div>
          ) : (
            <div className="d-flex flex-column gap-2">
              {filters.map((f, i) => (
                <div className="d-flex align-items-center gap-2 flex-wrap" key={f.field}>
                  <span className={`badge ${i === 0 ? 'bg-primary' : 'bg-secondary'} p-2`}>
                    {i === 0 ? '① 分析角度' : `${'②③④'[i - 1] ?? i + 1} 篩選`}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-dark"
                    title="編輯這個條件"
                    onClick={() => {
                      setEditing(f)
                      setModalOpen(true)
                    }}
                  >
                    <i className={`bi ${FilterFieldIcons[f.field]}`} /> {FilterFieldLabels[f.field]}：
                    {f.values.length <= 3
                      ? f.values.map((v) => labelOf(f.field, v)).join('、')
                      : `已選 ${f.values.length} 項`}
                  </button>
                  {i !== 0 && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => makePrimary(f.field)}
                    >
                      <i className="bi bi-arrow-up" /> 設為分析角度
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger"
                    aria-label="移除這個條件"
                    onClick={() => removeFilter(f.field)}
                  >
                    <i className="bi bi-x-lg" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---------- 統計卡 ---------- */}
      <div className="row g-3 mb-4">
        {[
          { label: `${FilterFieldLabels[primaryField]}項目數`, value: groups.length },
          { label: '領用人數', value: distinctRecipients },
          { label: '領取總次數', value: totalPickups },
          { label: '領取總件數', value: totalQuantity },
          { label: '涉及物資批次', value: distinctItems },
        ].map((c) => (
          <div className="col-md" key={c.label}>
            <div className="card shadow-sm h-100">
              <div className="card-body">
                <div className="text-muted small">{c.label}</div>
                <div className="fs-2 fw-bold">{c.value}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ---------- 樞紐表 ---------- */}
      <div className="card shadow-sm">
        <div className="card-header bg-light">
          <i className="bi bi-table" /> 依「{FilterFieldLabels[primaryField]}」彙總，明細看「
          {FilterFieldLabels[detailField]}」
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th className="col-min">排名</th>
                <th>{FilterFieldLabels[primaryField]}</th>
                <th className="col-min">領取次數</th>
                <th className="col-min">領取件數</th>
                <th className="col-min">領用人數</th>
                <th>
                  {FilterFieldLabels[detailField]}分佈（依件數排序）
                </th>
                <th className="col-min" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-4 text-muted">
                    載入中…
                  </td>
                </tr>
              ) : groups.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-4 text-muted">
                    {filters.length > 0 ? '沒有符合篩選條件的領取紀錄' : '目前沒有領取紀錄'}
                  </td>
                </tr>
              ) : (
                groups.map((g, i) => {
                  const isOpen = expanded.has(g.value)
                  const shown = isOpen ? g.details : g.details.slice(0, TOP_N)
                  const rest = g.details.length - shown.length
                  return (
                    // 一列可能展開成兩個 <tr>，所以用 Fragment 包起來；
                    // key 一定要下在 Fragment 上（下在裡面的 tr 不算）。
                    <Fragment key={g.value}>
                      <tr>
                        <td className="col-min">{i + 1}</td>
                        <td>
                          <strong>{g.label}</strong>
                        </td>
                        <td className="col-min">{g.pickupCount}</td>
                        <td className="col-min">
                          <strong>{g.quantity}</strong>
                        </td>
                        <td className="col-min">{g.recipientCount}</td>
                        <td>
                          <div className="d-flex flex-wrap gap-1">
                            {shown.map((d) => (
                              <span className="badge bg-light text-dark border" key={d.value}>
                                {d.label} <strong>{d.quantity}</strong>
                              </span>
                            ))}
                            {rest > 0 && <span className="badge bg-secondary">＋{rest} 項</span>}
                          </div>
                        </td>
                        <td className="col-min">
                          {g.details.length > 0 && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() => toggleExpand(g.value)}
                            >
                              <i className={`bi ${isOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} />{' '}
                              {isOpen ? '收合' : '展開'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="table-light">
                          <td />
                          <td colSpan={6}>
                            <table className="table table-sm mb-0 bg-white">
                              <thead>
                                <tr>
                                  <th>{FilterFieldLabels[detailField]}</th>
                                  <th className="col-min">次數</th>
                                  <th className="col-min">件數</th>
                                  <th style={{ width: '40%' }}>佔比</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.details.map((d) => {
                                  const pct = g.quantity ? Math.round((d.quantity / g.quantity) * 100) : 0
                                  return (
                                    <tr key={d.value}>
                                      <td>{d.label}</td>
                                      <td className="col-min">{d.pickupCount}</td>
                                      <td className="col-min">
                                        <strong>{d.quantity}</strong>
                                      </td>
                                      <td>
                                        <div className="d-flex align-items-center gap-2">
                                          <div className="progress flex-grow-1" style={{ height: 8 }}>
                                            <div className="progress-bar" style={{ width: `${pct}%` }} />
                                          </div>
                                          <span className="text-muted small">{pct}%</span>
                                        </div>
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <AnalysisFilterModal
          optionsOf={optionsOf}
          editing={editing}
          onCancel={() => {
            setModalOpen(false)
            setEditing(null)
          }}
          onApply={applyFilter}
        />
      )}
    </div>
  )
}

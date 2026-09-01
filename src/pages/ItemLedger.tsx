// 物資明細 —「一列一筆異動」的完整明細表。總管看全部據點並可調整；
// 幫主只看自己據點的明細並可調整（不顯示別據點）。
// 每筆物資從入庫開始，後續的 捐贈／領用／報廢／轉移／調整 都各自攤成一列，
// 顯示 類型／增減數量／說明。可用 關鍵字、據點、類型 篩選；匯出全部（右上角）。
// 操作：
//   調整 = 盤點修正該批次目前數量（走 stock_adjust RPC，留一筆「調整」）。
//   刪除 = 只對「調整」列開放，回算庫存（走 stock_adjust_delete RPC）。
// 領用／報廢／轉移不在這裡刪，請走各自的回庫／取消流程。
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { locationColorStyle } from '../lib/colors'
import { exportToExcel } from '../lib/excelExport'
import { FlashMessage } from '../components/FlashMessage'
import { DateRangeFilter } from '../components/DateRangeFilter'
 import { withinRange } from '../lib/dateRange'
import { useAuth } from '../hooks/useAuth'
import { Roles } from '../lib/enums'
import { logActivity } from '../lib/activityLog'
import type { SupplyLocation } from '../types/db'

interface LedgerItem {
  id: number
  category: string
  item_name: string
  specification: string | null
  unit: string | null
  quantity: number
  location_id: number
  created_at: string
  remark: string | null
}

type LedgerType = '入庫' | '捐贈' | '領用' | '報廢' | '轉移' | '調整'

interface LedgerEntry {
  key: string
  itemId: number
  category: string
  itemName: string
  specification: string | null
  unit: string | null
  currentQty: number // 該批次目前（最終）數量
  runningQty: number // 本筆異動後的當下數量（依時間累加）
  locationId: number
  time: string
  type: LedgerType
  delta: number | null
  detail: string
  operator: string | null
  adjustmentLogId?: number
}

const typeBadge: Record<LedgerType, string> = {
  入庫: 'bg-success',
  捐贈: 'bg-info text-dark',
  領用: 'bg-primary',
  報廢: 'bg-dark',
  轉移: 'bg-warning text-dark',
  調整: 'bg-secondary',
}
const AllTypes: LedgerType[] = ['入庫', '捐贈', '領用', '報廢', '轉移', '調整']

export function ItemLedger() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const myLocId = profile?.location_id ?? null
  // 幫主只看自己據點的明細並可「調整」；總管不限據點。
  const canAdjust = (locationId: number) => isAdmin || locationId === myLocId
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [items, setItems] = useState<LedgerItem[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [keyword, setKeyword] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // 調整（盤點修正）視窗
  const [adjustItem, setAdjustItem] = useState<LedgerItem | null>(null)
  const [adjustQty, setAdjustQty] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustSaving, setAdjustSaving] = useState(false)

  function locationName(id: number): string {
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  async function load() {
    setLoading(true)
    const [itemRes, locRes, stockRes, donRes, outRes, disRes, trfRes, adjRes] = await Promise.all([
      supabase.from('supply_item').select('id, category, item_name, specification, unit, quantity, location_id, created_at, remark'),
      supabase.from('supply_location').select('*').order('id'),
      supabase.from('supply_stock_in_log').select('supply_item_id, stock_in_quantity, stock_in_time, donor_name, operator, remark').limit(5000),
      supabase.from('supply_donation_log').select('supply_item_id, donation_quantity, donation_time, donor_name, operator, remark').limit(5000),
      supabase.from('supply_outbound_log').select('supply_item_id, outbound_quantity, outbound_time, recipient_name, is_cancelled, operator, remark').limit(5000),
      supabase.from('supply_disposal_log').select('supply_item_id, disposal_quantity, disposal_time, reason, operator, remark').limit(5000),
      supabase.from('supply_transfer_log').select('supply_item_id, transfer_quantity, from_location_id, to_location_id, transfer_time, status, operator, remark').limit(5000),
      supabase.from('supply_adjustment_log').select('*').limit(5000),
    ])

    const itemList = (itemRes.data ?? []) as LedgerItem[]
    const locs = (locRes.data ?? []) as SupplyLocation[]
    const itemById = new Map(itemList.map((i) => [i.id, i]))
    const locName = (id: number) => locs.find((l) => l.id === id)?.location_name ?? `#${id}`

    const list: LedgerEntry[] = []
    const base = (it: LedgerItem) => ({
      itemId: it.id,
      category: it.category,
      itemName: it.item_name,
      specification: it.specification,
      unit: it.unit,
      currentQty: it.quantity,
      runningQty: 0,
      locationId: it.location_id,
    })

    // 入庫：有入庫來源紀錄就用它；沒有的批次以建立時間補一筆。
    const hasStockIn = new Set<number>()
    for (const s of (stockRes.data ?? []) as Record<string, unknown>[]) {
      const it = itemById.get(s.supply_item_id as number)
      if (!it) continue
      hasStockIn.add(it.id)
      const donor = (s.donor_name as string)?.trim()
      list.push({
        ...base(it), key: `in-${it.id}-${s.stock_in_time}`, time: s.stock_in_time as string, type: '入庫',
        delta: s.stock_in_quantity as number,
        detail: `入庫${donor ? `（捐贈人 ${donor}）` : ''}`,
        operator: (s.operator as string) ?? null,
      })
    }
    for (const it of itemList) {
      if (hasStockIn.has(it.id)) continue
      list.push({ ...base(it), key: `in0-${it.id}`, time: it.created_at, type: '入庫', delta: it.quantity, detail: '建立批次', operator: null })
    }

    for (const d of (donRes.data ?? []) as Record<string, unknown>[]) {
      const it = itemById.get(d.supply_item_id as number); if (!it) continue
      list.push({ ...base(it), key: `don-${it.id}-${d.donation_time}`, time: d.donation_time as string, type: '捐贈', delta: d.donation_quantity as number, detail: `捐贈人 ${d.donor_name ?? '—'}`, operator: (d.operator as string) ?? null })
    }
    for (const o of (outRes.data ?? []) as Record<string, unknown>[]) {
      const it = itemById.get(o.supply_item_id as number); if (!it) continue
      const cancelled = o.is_cancelled === true
      list.push({ ...base(it), key: `out-${it.id}-${o.outbound_time}`, time: o.outbound_time as string, type: '領用', delta: cancelled ? 0 : -(o.outbound_quantity as number), detail: `發放給 ${o.recipient_name ?? '—'}${cancelled ? `（已取消回庫 ${o.outbound_quantity}）` : ''}`, operator: (o.operator as string) ?? null })
    }
    for (const d of (disRes.data ?? []) as Record<string, unknown>[]) {
      const it = itemById.get(d.supply_item_id as number); if (!it) continue
      list.push({ ...base(it), key: `dis-${it.id}-${d.disposal_time}`, time: d.disposal_time as string, type: '報廢', delta: -(d.disposal_quantity as number), detail: `原因：${d.reason ?? '—'}`, operator: (d.operator as string) ?? null })
    }
    for (const t of (trfRes.data ?? []) as Record<string, unknown>[]) {
      const it = itemById.get(t.supply_item_id as number); if (!it) continue
      list.push({ ...base(it), key: `trf-${it.id}-${t.transfer_time}`, time: t.transfer_time as string, type: '轉移', delta: null, detail: `${locName(t.from_location_id as number)} → ${locName(t.to_location_id as number)}（${t.transfer_quantity} ${it.unit ?? ''}，${t.status}）`, operator: (t.operator as string) ?? null })
    }
    for (const a of (adjRes.data ?? []) as Record<string, unknown>[]) {
      const it = itemById.get(a.supply_item_id as number); if (!it) continue
      list.push({ ...base(it), key: `adj-${a.id}`, time: a.adjusted_at as string, type: '調整', delta: a.delta as number, detail: `盤點修正 ${a.quantity_before}→${a.quantity_after}${a.reason ? `（${a.reason}）` : ''}`, operator: (a.operator as string) ?? null, adjustmentLogId: a.id as number })
    }

    // 依「批次(id) 由大到小，同批次內時間由早到晚」排序，讓每筆物資的異動聚在一起、第一筆是入庫。
    list.sort((x, y) => (x.itemId !== y.itemId ? y.itemId - x.itemId : x.time < y.time ? -1 : x.time > y.time ? 1 : 0))

    // 目前數量＝依時間累加各筆增減後的當下數量（轉移以文字呈現、不計入加減）。
    // 同批次內時間相同的多筆，用 list 內原始順序累加即可。
    let runId: number | null = null
    let run = 0
    for (const e of list) {
      if (e.itemId !== runId) { runId = e.itemId; run = 0 }
      run += e.delta ?? 0
      e.runningQty = run
    }

    setItems(itemList)
    setLocations(locs)
    setEntries(list)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    return entries.filter((e) => {
      // 幫主只看自己據點的明細（總管不限）。
      if (!isAdmin && myLocId != null && e.locationId !== myLocId) return false
      if (locationFilter && e.locationId !== Number(locationFilter)) return false
      if (typeFilter && e.type !== typeFilter) return false
      if (!withinRange(e.time, fromDate, toDate)) return false
      if (k && !`${e.category} ${e.itemName} ${e.specification ?? ''}`.toLowerCase().includes(k)) return false
      return true
    })
  }, [entries, keyword, locationFilter, typeFilter, fromDate, toDate, isAdmin, myLocId])

  function handleExport() {
    exportToExcel<LedgerEntry>('物資明細', '物資明細', [
      { header: '流水號', value: (e) => e.itemId },
      { header: '種類', value: (e) => e.category },
      { header: '名稱', value: (e) => e.itemName },
      { header: '規格', value: (e) => e.specification ?? '' },
      { header: '類型', value: (e) => e.type },
      { header: '增減數量', value: (e) => (e.delta == null ? '' : e.delta), total: true },
      { header: '說明', value: (e) => e.detail },
      { header: '目前數量', value: (e) => e.runningQty },
      { header: '所在據點', value: (e) => locationName(e.locationId) },
      { header: '時間', value: (e) => new Date(e.time).toLocaleString('zh-TW') },
      { header: '操作人', value: (e) => e.operator ?? '' },
    ], filtered)
  }

  function openAdjust(itemId: number) {
    const it = items.find((i) => i.id === itemId)
    if (!it) return
    setAdjustItem(it)
    setAdjustQty(String(it.quantity))
    setAdjustReason('')
    setError(null)
  }

  async function submitAdjust(e: FormEvent) {
    e.preventDefault()
    if (!adjustItem) return
    const n = Number(adjustQty)
    if (!Number.isInteger(n) || n < 0) {
      setError('調整後數量必須是 0 或正整數')
      return
    }
    setAdjustSaving(true)
    const { error: rpcErr } = await supabase.rpc('stock_adjust', {
      p_supply_item_id: adjustItem.id,
      p_new_quantity: n,
      p_reason: adjustReason.trim() || null,
    })
    setAdjustSaving(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    void logActivity({ action: 'adjust', category: '庫存異動', targetTable: 'supply_item', targetId: adjustItem.id, locationId: adjustItem.location_id, summary: `盤點調整「${adjustItem.item_name}」為 ${n} ${adjustItem.unit ?? ''}`, detail: { before: adjustItem.quantity, after: n, reason: adjustReason.trim() || null } })
    setAdjustItem(null)
    void load()
  }

  async function deleteAdjust(logId: number) {
    if (!confirm('確定刪除這筆調整嗎？系統會把當初的增減回算回去。')) return
    const { error: rpcErr } = await supabase.rpc('stock_adjust_delete', { p_log_id: logId })
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    void logActivity({ action: 'adjust_delete', category: '庫存異動', targetTable: 'supply_adjustment_log', targetId: logId, summary: `刪除盤點調整紀錄 #${logId}（回算庫存）` })
    void load()
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="mb-0">
          <i className="bi bi-clock-history" /> 物資明細
        </h2>
        <button className="btn btn-outline-success" onClick={handleExport} disabled={filtered.length === 0}>
          <i className="bi bi-file-earmark-excel" /> 匯出 Excel
        </button>
      </div>
      <p className="text-muted">每一筆物資從入庫到後續 領用／捐贈／報廢／轉移／調整 的完整異動歷程（總管專用）。</p>
      <FlashMessage />
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card shadow-sm mb-3">
        <div className="card-header bg-light">
          <i className="bi bi-funnel" /> 篩選條件
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-5">
              <label className="form-label">關鍵字</label>
              <input className="form-control" placeholder="物資名稱、種類、規格" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="col-md-2">
              <label className="form-label">類型</label>
              <select className="form-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">全部類型</option>
                {AllTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">據點</label>
              {isAdmin ? (
                <select className="form-select" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                  <option value="">全部據點</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.location_name}</option>
                  ))}
                </select>
              ) : (
                <input className="form-control" disabled value={locationName(myLocId ?? -1)} />
              )}
            </div>
            <div className="col-md-4">
              <label className="form-label">異動日期區間</label>
              <DateRangeFilter from={fromDate} to={toDate} onFrom={setFromDate} onTo={setToDate} />
            </div>
            <div className="col-md-2 d-flex align-items-end">
              <button type="button" className="btn btn-secondary w-100" onClick={() => { setKeyword(''); setLocationFilter(''); setTypeFilter(''); setFromDate(''); setToDate('') }}>
                <i className="bi bi-arrow-clockwise" /> 重設
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card shadow-sm">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th className="col-min">流水號</th>
                  <th>種類</th>
                  <th>名稱</th>
                  <th>規格</th>
                  <th className="col-min">類型</th>
                  <th className="col-min text-end">增減數量</th>
                  <th>說明</th>
                  <th className="col-min text-end">目前數量</th>
                  <th className="col-min">所在據點</th>
                  <th className="col-min">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="text-center py-4 text-muted">載入中…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-4 text-muted">沒有符合條件的異動</td></tr>
                ) : (
                  filtered.map((e) => (
                    <tr key={e.key}>
                      <td className="col-min text-muted">#{e.itemId}</td>
                      <td>{e.category}</td>
                      <td><strong>{e.itemName}</strong></td>
                      <td>{e.specification ?? '無'}</td>
                      <td className="col-min"><span className={`badge ${typeBadge[e.type]}`}>{e.type}</span></td>
                      <td className={`col-min text-end ${e.delta == null ? '' : e.delta >= 0 ? 'text-success' : 'text-danger'}`}>
                        {e.delta == null ? '—' : e.delta > 0 ? `+${e.delta}` : e.delta} {e.delta == null ? '' : e.unit ?? ''}
                      </td>
                      <td>{e.detail}</td>
                      <td className="col-min text-end">{e.runningQty} {e.unit ?? ''}</td>
                      <td className="col-min">
                        <span className="badge" style={locationColorStyle(e.locationId)}>{locationName(e.locationId)}</span>
                      </td>
                      <td className="col-min text-nowrap">
                        {canAdjust(e.locationId) ? (
                          <>
                            <button className="btn btn-sm btn-outline-secondary me-1" title="盤點調整此批次數量" onClick={() => openAdjust(e.itemId)}>
                              <i className="bi bi-sliders" /> 調整
                            </button>
                            {e.type === '調整' && e.adjustmentLogId != null && (
                              <button className="btn btn-sm btn-outline-danger" title="刪除此調整並回算" onClick={() => void deleteAdjust(e.adjustmentLogId!)}>
                                <i className="bi bi-trash" />
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="text-muted small">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3"><p className="text-muted mb-0">共 {filtered.length} 筆異動</p></div>
        </div>
      </div>

      {/* 調整（盤點修正） */}
      {adjustItem && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <form onSubmit={submitAdjust}>
                <div className="modal-header">
                  <h5 className="modal-title"><i className="bi bi-sliders" /> 盤點調整</h5>
                  <button type="button" className="btn-close" onClick={() => setAdjustItem(null)} />
                </div>
                <div className="modal-body">
                  <div className="alert alert-light border small mb-3">
                    #{adjustItem.id}｜{adjustItem.category}｜{adjustItem.item_name}
                    {adjustItem.specification ? `｜${adjustItem.specification}` : ''}｜{locationName(adjustItem.location_id)}
                    <div className="text-muted">目前數量 {adjustItem.quantity} {adjustItem.unit ?? ''}</div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">調整後數量 *</label>
                    <input className="form-control" type="number" min={0} required value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} />
                    <div className="form-text">
                      將把目前數量修正為此值，並在明細留一筆「調整」（增減 {Number.isFinite(Number(adjustQty)) ? Number(adjustQty) - adjustItem.quantity : 0}）。
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">原因／說明</label>
                    <input className="form-control" placeholder="例如：盤點盤盈、損耗、輸入錯誤更正" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setAdjustItem(null)}>取消</button>
                  <button type="submit" className="btn btn-primary" disabled={adjustSaving}>{adjustSaving ? '處理中…' : '確認調整'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

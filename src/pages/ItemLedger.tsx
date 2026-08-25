// 分工單 p.16（只有總管）：物資明細。
// 把每一筆物資（supply_item 批次）的異動歷程整合成一條時間軸：
// 第一筆一定是「入庫」（該批 supply_item 建立），後續依時間串接 捐贈／出庫／報廢／轉移。
// 目前「調整」沒有獨立紀錄表（物資清單的編輯是就地改數量、未留痕），故先不含調整項，
// 待之後補上 adjustment log 再併入。此頁為唯讀報表，出庫等實際動作仍在各自功能頁進行。
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { locationColorStyle } from '../lib/colors'
import { exportToExcel } from '../lib/excelExport'
import type { SupplyItem, SupplyLocation } from '../types/db'

type LedgerType = '入庫' | '捐贈' | '出庫' | '報廢' | '轉移'

interface LedgerEntry {
  time: string
  type: LedgerType
  delta: number | null // 對本批數量的增減；轉移方向較複雜，以 detail 說明
  detail: string
  operator: string | null
  remark: string | null
}

const typeBadge: Record<LedgerType, string> = {
  入庫: 'bg-success',
  捐贈: 'bg-info text-dark',
  出庫: 'bg-primary',
  報廢: 'bg-dark',
  轉移: 'bg-warning text-dark',
}

export function ItemLedger() {
  const [items, setItems] = useState<SupplyItem[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [loading, setLoading] = useState(true)

  const [keyword, setKeyword] = useState('')
  const [locationFilter, setLocationFilter] = useState('')

  const [selected, setSelected] = useState<SupplyItem | null>(null)
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('supply_item').select('*').eq('is_active', true).order('id', { ascending: false }),
      supabase.from('supply_location').select('*').order('id'),
    ]).then(([itemRes, locRes]) => {
      setItems((itemRes.data ?? []) as SupplyItem[])
      setLocations((locRes.data ?? []) as SupplyLocation[])
      setLoading(false)
    })
  }, [])

  function locationName(id: number): string {
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (locationFilter && i.location_id !== Number(locationFilter)) return false
      if (keyword.trim()) {
        const k = keyword.trim().toLowerCase()
        return (
          i.item_name.toLowerCase().includes(k) ||
          i.category.toLowerCase().includes(k) ||
          (i.specification ?? '').toLowerCase().includes(k)
        )
      }
      return true
    })
  }, [items, keyword, locationFilter])

  async function openLedger(item: SupplyItem) {
    setSelected(item)
    setLedgerLoading(true)

    const [outRes, donRes, disRes, trfRes] = await Promise.all([
      supabase.from('supply_outbound_log').select('*').eq('supply_item_id', item.id),
      supabase.from('supply_donation_log').select('*').eq('supply_item_id', item.id),
      supabase.from('supply_disposal_log').select('*').eq('supply_item_id', item.id),
      supabase.from('supply_transfer_log').select('*').eq('supply_item_id', item.id),
    ])

    const list: LedgerEntry[] = []

    // 第一筆：入庫（該批建立）
    list.push({
      time: item.created_at,
      type: '入庫',
      delta: item.quantity,
      detail: `建立批次，初始數量 ${item.quantity} ${item.unit ?? ''}`,
      operator: null,
      remark: item.remark ?? null,
    })

    for (const o of (outRes.data ?? []) as Record<string, unknown>[]) {
      // 已取消（回庫）的出庫：庫存已退回，淨變動為 0，明細標註「已取消」避免重複扣。
      const cancelled = o.is_cancelled === true
      list.push({
        time: o.outbound_time as string,
        type: '出庫',
        delta: cancelled ? 0 : -(o.outbound_quantity as number),
        detail: `發放給 ${o.recipient_name ?? '—'}${cancelled ? `（已取消回庫 ${o.outbound_quantity}）` : ''}`,
        operator: (o.operator as string) ?? null,
        remark: (o.remark as string) ?? null,
      })
    }
    for (const d of (donRes.data ?? []) as Record<string, unknown>[]) {
      list.push({
        time: d.donation_time as string,
        type: '捐贈',
        delta: d.donation_quantity as number,
        detail: `捐贈人 ${d.donor_name ?? '—'}`,
        operator: (d.operator as string) ?? null,
        remark: (d.remark as string) ?? null,
      })
    }
    for (const d of (disRes.data ?? []) as Record<string, unknown>[]) {
      list.push({
        time: d.disposal_time as string,
        type: '報廢',
        delta: -(d.disposal_quantity as number),
        detail: `原因：${d.reason ?? '—'}`,
        operator: (d.operator as string) ?? null,
        remark: (d.remark as string) ?? null,
      })
    }
    for (const t of (trfRes.data ?? []) as Record<string, unknown>[]) {
      list.push({
        time: t.transfer_time as string,
        type: '轉移',
        delta: null,
        detail: `${locationName(t.from_location_id as number)} → ${locationName(t.to_location_id as number)}（${t.transfer_quantity} ${item.unit ?? ''}，${t.status}）`,
        operator: (t.operator as string) ?? null,
        remark: (t.remark as string) ?? null,
      })
    }

    list.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
    setEntries(list)
    setLedgerLoading(false)
  }

  function handleExportLedger() {
    if (!selected) return
    exportToExcel<LedgerEntry>(
      `物資明細_${selected.item_name}`,
      '物資明細',
      [
        { header: '時間', value: (e) => new Date(e.time).toLocaleString('zh-TW') },
        { header: '類型', value: (e) => e.type },
        { header: '數量增減', value: (e) => (e.delta == null ? '' : e.delta) },
        { header: '說明', value: (e) => e.detail },
        { header: '操作人', value: (e) => e.operator ?? '' },
        { header: '備註', value: (e) => e.remark ?? '' },
      ],
      entries
    )
  }

  return (
    <div className="container-fluid mt-4">
      <h2 className="mb-4">
        <i className="bi bi-clock-history" /> 物資明細
      </h2>
      <p className="text-muted">每一筆物資從入庫到後續出庫／捐贈／報廢／轉移的完整異動歷程（總管專用）。</p>

      <div className="card shadow-sm mb-3">
        <div className="card-header bg-light">
          <i className="bi bi-funnel" /> 篩選條件
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label">關鍵字</label>
              <input className="form-control" placeholder="物資名稱、種類、規格" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="col-md-4">
              <label className="form-label">據點</label>
              <select className="form-select" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                <option value="">全部據點</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.location_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2 d-flex align-items-end">
              <button
                type="button"
                className="btn btn-secondary w-100"
                onClick={() => {
                  setKeyword('')
                  setLocationFilter('')
                }}
              >
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
                  <th className="col-min">目前數量</th>
                  <th className="col-min">所在據點</th>
                  <th className="col-min">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-4 text-muted">
                      載入中…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-4 text-muted">
                      沒有符合條件的物資
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => (
                    <tr key={item.id}>
                      <td className="col-min">#{item.id}</td>
                      <td>{item.category}</td>
                      <td>
                        <strong>{item.item_name}</strong>
                      </td>
                      <td>{item.specification ?? '無'}</td>
                      <td className="col-min">
                        {item.quantity} {item.unit}
                      </td>
                      <td className="col-min">
                        <span className="badge" style={locationColorStyle(item.location_id)}>
                          {locationName(item.location_id)}
                        </span>
                      </td>
                      <td className="col-min">
                        <button className="btn btn-sm btn-primary" onClick={() => void openLedger(item)}>
                          <i className="bi bi-clock-history" /> 查看明細
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 明細時間軸 */}
      {selected && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-clock-history" /> {selected.category}｜{selected.item_name}
                  {selected.specification ? `｜${selected.specification}` : ''}｜{locationName(selected.location_id)}
                </h5>
                <button type="button" className="btn-close" onClick={() => setSelected(null)} />
              </div>
              <div className="modal-body">
                {ledgerLoading ? (
                  <div className="text-center py-4 text-muted">載入異動歷程…</div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-sm align-middle mb-0" style={{ width: 'auto' }}>
                      <thead className="table-light">
                        <tr>
                          <th>時間</th>
                          <th>類型</th>
                          <th>數量增減</th>
                          <th>說明</th>
                          <th>操作人</th>
                          <th>備註</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((e, i) => (
                          <tr key={i}>
                            <td className="text-nowrap">{new Date(e.time).toLocaleString('zh-TW')}</td>
                            <td>
                              <span className={`badge ${typeBadge[e.type]}`}>{e.type}</span>
                            </td>
                            <td className={e.delta == null ? '' : e.delta >= 0 ? 'text-success' : 'text-danger'}>
                              {e.delta == null ? '—' : e.delta > 0 ? `+${e.delta}` : e.delta}
                            </td>
                            <td>{e.detail}</td>
                            <td>{e.operator ?? '—'}</td>
                            <td>{e.remark ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-success" onClick={handleExportLedger} disabled={ledgerLoading || entries.length === 0}>
                  <i className="bi bi-file-earmark-excel" /> 匯出報表
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setSelected(null)}>
                  關閉
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

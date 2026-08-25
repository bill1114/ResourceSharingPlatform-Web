// 捐贈分析 — 參考領取分析的架構與概念（統計卡 + 篩選 + 可展開的樞紐），
// 但以「捐贈人」為主軸，並加上核心的「物流追蹤」：
// 捐贈人貢獻的物資批次，後續被誰領用走。
//
// 資料來源：
//   捐贈人的貢獻同時來自「物資捐贈」(supply_donation_log) 與「物資入庫」
//   (supply_stock_in_log 有填捐贈人者)，兩者都以 supply_item_id 連到批次。
//   流向則靠同一個 supply_item_id 對應到 supply_outbound_log 的領用人。
//
// ⚠️ 重要限制（批次層級追蹤）：
//   一個批次可能混入多位捐贈人的捐贈，出庫時採先進先出、不會標記「發給誰的是誰捐的」。
//   因此「流向」是批次層級的近似：呈現「這位捐贈人貢獻過的批次，後續發放給哪些領用人」，
//   而非精確的一對一歸屬。畫面與匯出都以此語意呈現。
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { locationColorStyle } from '../lib/colors'
import { recipientIdentityDisplayName } from '../lib/yunlinDistricts'
import { exportToExcel } from '../lib/excelExport'
import type { SupplyItem, SupplyLocation, DonationSource } from '../types/db'

interface DonationRow {
  source: '捐贈' | '入庫'
  donorName: string
  donorContact: string
  donorAddress: string
  donorDistrict: string
  donorIdentity: string
  supplyItemId: number
  quantity: number
  time: string
  locationId: number
}

interface OutboundRow {
  supply_item_id: number
  recipient_name: string
  recipient_contact: string | null
  recipient_identity: string | null
  recipient_district: string | null
  outbound_quantity: number
  outbound_time: string
  is_cancelled: boolean
}

interface FlowRecipient {
  name: string
  identity: string | null
  district: string | null
  quantity: number
  count: number
}

interface DonorGroup {
  key: string
  donorName: string
  donorContact: string
  donations: DonationRow[]
  address: string // 代表性聯絡地址（來自入庫來源紀錄，取最近一筆有填的）
  district: string // 代表性鄉鎮
  identity: string // 代表性身分別
  totalQuantity: number
  itemIds: number[]
  issuedQuantity: number // 這些批次後續已發放件數（批次層級）
  onHandQuantity: number // 這些批次目前在庫件數
  flow: FlowRecipient[]
}

export function DonorAnalysis() {
  const [donations, setDonations] = useState<DonationRow[]>([])
  const [outbounds, setOutbounds] = useState<OutboundRow[]>([])
  const [items, setItems] = useState<SupplyItem[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [loading, setLoading] = useState(true)

  // 篩選：捐贈人關鍵字 / 物資品項 / 捐入據點
  const [keyword, setKeyword] = useState('')
  const [itemFilter, setItemFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [srcRes, outRes, itemRes, locRes] = await Promise.all([
        // 統一來源：物資捐贈 + 物資入庫(有捐贈人) 都在這個 view 裡。
        supabase.from('donation_source_view').select('*').limit(10000),
        supabase.from('supply_outbound_log').select('supply_item_id, recipient_name, recipient_contact, recipient_identity, recipient_district, outbound_quantity, outbound_time, is_cancelled').limit(5000),
        supabase.from('supply_item').select('id, item_name, category, specification, unit, quantity, location_id'),
        supabase.from('supply_location').select('id, location_name'),
      ])

      const merged: DonationRow[] = ((srcRes.data ?? []) as DonationSource[]).map((s) => ({
        source: s.source_type === 'donation' ? '捐贈' : '入庫',
        donorName: s.donor_name.trim(),
        donorContact: s.donor_contact ?? '',
        donorAddress: s.donor_address ?? '',
        donorDistrict: s.donor_district ?? '',
        donorIdentity: s.donor_identity ?? '',
        supplyItemId: s.supply_item_id,
        quantity: s.quantity,
        time: s.source_time,
        locationId: s.location_id,
      }))

      setDonations(merged)
      setOutbounds(((outRes.data ?? []) as OutboundRow[]).filter((o) => !o.is_cancelled))
      setItems((itemRes.data ?? []) as SupplyItem[])
      setLocations((locRes.data ?? []) as SupplyLocation[])
      setLoading(false)
    }
    void load()
  }, [])

  const itemOf = (id: number) => items.find((i) => i.id === id)
  const itemNameOf = (id: number) => itemOf(id)?.item_name ?? `物資 #${id}`
  const locationName = (id: number) => locations.find((l) => l.id === id)?.location_name ?? `#${id}`

  const itemNames = useMemo(() => Array.from(new Set(donations.map((d) => itemNameOf(d.supplyItemId)))).sort(), [donations, items])

  // 套用篩選後的捐贈明細
  const filteredDonations = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    return donations.filter((d) => {
      if (itemFilter && itemNameOf(d.supplyItemId) !== itemFilter) return false
      if (locationFilter && d.locationId !== Number(locationFilter)) return false
      if (k && !`${d.donorName} ${d.donorContact}`.toLowerCase().includes(k)) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [donations, keyword, itemFilter, locationFilter, items])

  // 依捐贈人彙總 + 物流追蹤
  const groups = useMemo<DonorGroup[]>(() => {
    const map = new Map<string, DonorGroup>()
    for (const d of filteredDonations) {
      const key = `${d.donorName}||${d.donorContact}`
      let g = map.get(key)
      if (!g) {
        g = { key, donorName: d.donorName, donorContact: d.donorContact, donations: [], address: '', district: '', identity: '', totalQuantity: 0, itemIds: [], issuedQuantity: 0, onHandQuantity: 0, flow: [] }
        map.set(key, g)
      }
      g.donations.push(d)
      g.totalQuantity += d.quantity
    }

    for (const g of map.values()) {
      const itemIdSet = new Set(g.donations.map((d) => d.supplyItemId))
      g.itemIds = [...itemIdSet]
      g.onHandQuantity = g.itemIds.reduce((s, id) => s + (itemOf(id)?.quantity ?? 0), 0)

      // 物流追蹤：這些批次的出庫紀錄，依領用人彙總。
      const recipMap = new Map<string, FlowRecipient>()
      for (const o of outbounds) {
        if (!itemIdSet.has(o.supply_item_id)) continue
        g.issuedQuantity += o.outbound_quantity
        const rk = `${o.recipient_name}||${o.recipient_contact ?? ''}`
        let r = recipMap.get(rk)
        if (!r) {
          r = { name: o.recipient_name, identity: o.recipient_identity, district: o.recipient_district, quantity: 0, count: 0 }
          recipMap.set(rk, r)
        }
        r.quantity += o.outbound_quantity
        r.count += 1
      }
      g.flow = [...recipMap.values()].sort((a, b) => b.quantity - a.quantity)
      g.donations.sort((a, b) => (a.time < b.time ? 1 : -1))
      // 代表性資料：入庫來源紀錄中最近一筆有填的（捐贈頁本身沒有這些欄位）。
      g.address = g.donations.find((d) => d.donorAddress.trim())?.donorAddress.trim() ?? ''
      g.district = g.donations.find((d) => d.donorDistrict.trim())?.donorDistrict.trim() ?? ''
      g.identity = g.donations.find((d) => d.donorIdentity.trim())?.donorIdentity.trim() ?? ''
    }

    return [...map.values()].sort((a, b) => b.totalQuantity - a.totalQuantity)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredDonations, outbounds, items])

  const totalDonors = groups.length
  const totalDonations = filteredDonations.length
  const totalQuantity = filteredDonations.reduce((s, d) => s + d.quantity, 0)
  const distinctItems = useMemo(() => new Set(filteredDonations.map((d) => d.supplyItemId)).size, [filteredDonations])

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function resetFilters() {
    setKeyword('')
    setItemFilter('')
    setLocationFilter('')
  }

  function handleExport() {
    exportToExcel<DonorGroup>('捐贈分析', '捐贈分析', [
      { header: '排名', value: (g) => groups.indexOf(g) + 1 },
      { header: '捐贈人', value: (g) => g.donorName },
      { header: '聯絡方式', value: (g) => g.donorContact || '' },
      { header: '聯絡地址', value: (g) => g.address || '' },
      { header: '鄉鎮', value: (g) => g.district || '' },
      { header: '身分別', value: (g) => (g.identity ? recipientIdentityDisplayName(g.identity) : '') },
      { header: '捐贈筆數', value: (g) => g.donations.length },
      { header: '捐贈件數', value: (g) => g.totalQuantity },
      { header: '不同物資', value: (g) => new Set(g.donations.map((d) => d.supplyItemId)).size },
      { header: '批次已發放件數', value: (g) => g.issuedQuantity },
      { header: '批次目前在庫', value: (g) => g.onHandQuantity },
      { header: '主要流向（領用人 件數）', value: (g) => g.flow.slice(0, 10).map((r) => `${r.name} ${r.quantity}`).join('、') },
    ], groups)
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0">
          <i className="bi bi-heart" /> 捐贈分析
        </h2>
        <button className="btn btn-outline-success" onClick={handleExport} disabled={groups.length === 0}>
          <i className="bi bi-file-earmark-excel" /> 匯出 Excel
        </button>
      </div>

      <div className="alert alert-light border small">
        <i className="bi bi-info-circle" /> 「物流追蹤」為<strong>批次層級</strong>的近似：呈現這位捐贈人貢獻過的批次後續發放給哪些領用人。
        由於一個批次可能混入多位捐贈人、出庫採先進先出，並非精確的一對一歸屬。
      </div>

      {/* 統計卡 */}
      <div className="row g-3 mb-4">
        {[
          { label: '捐贈人數', value: totalDonors },
          { label: '捐贈總筆數', value: totalDonations },
          { label: '捐贈總件數', value: totalQuantity },
          { label: '涉及物資批次', value: distinctItems },
        ].map((c) => (
          <div className="col-md-3" key={c.label}>
            <div className="card shadow-sm h-100">
              <div className="card-body">
                <div className="text-muted small">{c.label}</div>
                <div className="fs-2 fw-bold">{c.value}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 篩選 */}
      <div className="card shadow-sm mb-3">
        <div className="card-header bg-light">
          <i className="bi bi-funnel" /> 篩選條件
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">捐贈人關鍵字</label>
              <input className="form-control" placeholder="搜尋捐贈人或聯絡方式" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="col-md-3">
              <label className="form-label">物資品項</label>
              <select className="form-select" value={itemFilter} onChange={(e) => setItemFilter(e.target.value)}>
                <option value="">全部品項</option>
                {itemNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">捐入據點</label>
              <select className="form-select" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                <option value="">全部據點</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.location_name}</option>
                ))}
              </select>
            </div>
            <div className="col-md-2 d-flex align-items-end">
              <button type="button" className="btn btn-secondary w-100" onClick={resetFilters}>
                <i className="bi bi-arrow-clockwise" /> 重設
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 樞紐表：一列一捐贈人 */}
      <div className="card shadow-sm">
        <div className="card-header bg-light">
          <i className="bi bi-table" /> 依捐贈人彙總（展開可看捐贈明細與物流追蹤）
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th className="col-min">排名</th>
                <th>捐贈人</th>
                <th>聯絡方式</th>
                <th className="col-min">捐贈筆數</th>
                <th className="col-min">捐贈件數</th>
                <th className="col-min">不同物資</th>
                <th className="col-min">批次已發放</th>
                <th className="col-min">批次在庫</th>
                <th className="col-min" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-4 text-muted">載入中…</td></tr>
              ) : groups.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-4 text-muted">沒有符合條件的捐贈紀錄</td></tr>
              ) : (
                groups.map((g, i) => {
                  const isOpen = expanded.has(g.key)
                  return (
                    <Fragment key={g.key}>
                      <tr>
                        <td className="col-min">{i + 1}</td>
                        <td><strong>{g.donorName}</strong></td>
                        <td>{g.donorContact || '—'}</td>
                        <td className="col-min">{g.donations.length}</td>
                        <td className="col-min"><strong>{g.totalQuantity}</strong></td>
                        <td className="col-min">{new Set(g.donations.map((d) => d.supplyItemId)).size}</td>
                        <td className="col-min">{g.issuedQuantity}</td>
                        <td className="col-min">{g.onHandQuantity}</td>
                        <td className="col-min">
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => toggle(g.key)}>
                            <i className={`bi ${isOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} /> {isOpen ? '收合' : '展開'}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="table-light">
                          <td />
                          <td colSpan={8}>
                            <div className="small text-muted mb-2">
                              <i className="bi bi-person-vcard" /> 聯絡方式：{g.donorContact || '未填'}
                              <span className="ms-3"><i className="bi bi-geo-alt" /> 聯絡地址：{g.address || '未填'}</span>
                              <span className="ms-3"><i className="bi bi-pin-map" /> 鄉鎮：{g.district || '未填'}</span>
                              <span className="ms-3"><i className="bi bi-award" /> 身分別：{g.identity ? recipientIdentityDisplayName(g.identity) : '未填'}</span>
                            </div>
                            <div className="row g-3 py-2">
                              {/* 捐贈明細 */}
                              <div className="col-lg-6">
                                <div className="fw-bold mb-2"><i className="bi bi-box-seam" /> 捐了什麼</div>
                                <table className="table table-sm bg-white mb-0">
                                  <thead><tr><th>日期</th><th>物資</th><th className="col-min">數量</th><th className="col-min">來源</th><th>捐入據點</th></tr></thead>
                                  <tbody>
                                    {g.donations.map((d, idx) => {
                                      const it = itemOf(d.supplyItemId)
                                      return (
                                        <tr key={idx}>
                                          <td>{new Date(d.time).toLocaleDateString('zh-TW')}</td>
                                          <td>{itemNameOf(d.supplyItemId)}{it?.specification ? <span className="text-muted">／{it.specification}</span> : null}</td>
                                          <td className="col-min">{d.quantity} {it?.unit ?? ''}</td>
                                          <td className="col-min"><span className={`badge ${d.source === '捐贈' ? 'bg-info text-dark' : 'bg-success'}`}>{d.source}</span></td>
                                          <td><span className="badge" style={locationColorStyle(d.locationId)}>{locationName(d.locationId)}</span></td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                              {/* 物流追蹤 */}
                              <div className="col-lg-6">
                                <div className="fw-bold mb-2"><i className="bi bi-arrow-right-circle" /> 物流追蹤：這些批次後來發放給誰</div>
                                {g.flow.length === 0 ? (
                                  <div className="text-muted small py-2">這些批次目前還沒有發放紀錄（可能仍在庫或已轉移）。</div>
                                ) : (
                                  <table className="table table-sm bg-white mb-0">
                                    <thead><tr><th>領用人</th><th className="col-min">身分別</th><th>鄉鎮</th><th className="col-min">領取件數</th></tr></thead>
                                    <tbody>
                                      {g.flow.map((r, idx) => (
                                        <tr key={idx}>
                                          <td><strong>{r.name || '（未填）'}</strong></td>
                                          <td className="col-min">{r.identity ? recipientIdentityDisplayName(r.identity) : '—'}</td>
                                          <td>{r.district || '—'}</td>
                                          <td className="col-min"><strong>{r.quantity}</strong></td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                                <div className="text-muted small mt-2">
                                  批次合計：已發放 <strong>{g.issuedQuantity}</strong>、目前在庫 <strong>{g.onHandQuantity}</strong>。
                                </div>
                              </div>
                            </div>
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
    </div>
  )
}

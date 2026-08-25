// 戰情總覽色塊點擊後跳來的「狀態清單」頁（分工單 p.2 跳頁 + p.4 共用版面 + p.5/6/7 舉手）。
// 舉手邏輯（依需求修正）：需求方＝「我的據點」（自動、不用選），要選的是「哪個據點有貨」——
// 來源下拉只列出實際有此品項庫存的其他據點並顯示現有數量。來源據點之後透過物資轉移補貨。
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { locationColorStyle } from '../lib/colors'
import { statusColorMap, type DashboardStatusKey } from '../lib/statusColors'
import { fetchLowStock, isItemLowStock, emptyLowStock, type LowStockData } from '../lib/lowStock'
import { itemPhotoUrl } from '../lib/imageUpload'
import { stockTypeDisplayName, stockTypeBadgeClass, Roles } from '../lib/enums'
import { FlashMessage } from '../components/FlashMessage'
import type { SupplyItem, SupplyLocation } from '../types/db'

interface Row {
  key: string
  id: number | null // supply_item 流水號；總量不足為 null
  image_path: string | null
  category: string
  item_name: string
  specification: string | null
  stock_type: string | null
  unit: string | null
  locationId: number | null // null = 全系統（總量不足）
  quantity: number | null
  expiration: string | null
  note: string | null // 門檻等附註（總量不足用）
}

interface GlobalLowRow {
  category: string
  item_name: string
  specification: string | null
  unit: string
  global_safety_stock: number
  global_threshold: number
  total_quantity: number
}

function isValidStatus(s: string | undefined): s is DashboardStatusKey {
  return s === 'locationLowStock' || s === 'globalLowStock' || s === 'expiringSoon' || s === 'expired'
}

export function StatusList() {
  const { status } = useParams<{ status: string }>()
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [items, setItems] = useState<SupplyItem[]>([])
  const [globalLow, setGlobalLow] = useState<GlobalLowRow[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [lowStock, setLowStock] = useState<LowStockData>(emptyLowStock)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(true)

  // 舉手彈窗
  const [raiseRow, setRaiseRow] = useState<Row | null>(null)
  const [srcLocationId, setSrcLocationId] = useState('')
  const [reqLocationId, setReqLocationId] = useState('') // 只有無法自動判斷時（管理員／總量不足）才需手選
  const [reqQuantity, setReqQuantity] = useState('1')
  const [reqNote, setReqNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [itemsRes, locRes, globalRes, low] = await Promise.all([
        supabase.from('supply_item').select('*').eq('is_active', true).order('expiration_date', { ascending: true, nullsFirst: false }),
        supabase.from('supply_location').select('*').eq('is_active', true).order('id'),
        supabase.from('global_low_stock_view').select('category, item_name, specification, unit, global_safety_stock, global_threshold, total_quantity'),
        fetchLowStock(),
      ])
      setItems((itemsRes.data ?? []) as SupplyItem[])
      setLocations((locRes.data ?? []) as SupplyLocation[])
      setGlobalLow((globalRes.data ?? []) as GlobalLowRow[])
      setLowStock(low)
      setLoading(false)
    }
    void load()
  }, [])

  function locationName(id: number | null): string {
    if (id == null) return '（全系統）'
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  const today = new Date().toISOString().slice(0, 10)
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

  const rows = useMemo<Row[]>(() => {
    if (!isValidStatus(status)) return []
    if (status === 'globalLowStock') {
      return globalLow.map((g) => ({
        key: `g-${g.category}-${g.item_name}-${g.specification ?? ''}`,
        id: null,
        image_path: null,
        category: g.category,
        item_name: g.item_name,
        specification: g.specification,
        stock_type: null,
        unit: g.unit,
        locationId: null,
        quantity: g.total_quantity,
        expiration: null,
        note: `募資觸發點 ${Math.max(0, g.global_threshold - g.global_safety_stock)} ${g.unit}（門檻 ${g.global_threshold} − 安全 ${g.global_safety_stock}，請啟動募資）`,
      }))
    }
    const picked = items.filter((it) => {
      if (status === 'locationLowStock') return isItemLowStock(it, lowStock)
      if (status === 'expiringSoon') return it.expiration_date != null && it.expiration_date >= today && it.expiration_date <= in30
      if (status === 'expired') return it.expiration_date != null && it.expiration_date < today
      return false
    })
    return picked.map((it) => ({
      key: `i-${it.id}`,
      id: it.id,
      image_path: it.image_path,
      category: it.category,
      item_name: it.item_name,
      specification: it.specification,
      stock_type: it.stock_type,
      unit: it.unit,
      locationId: it.location_id,
      quantity: it.quantity,
      expiration: it.expiration_date,
      note: null,
    }))
  }, [status, items, globalLow, lowStock, today, in30])

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    if (!k) return rows
    return rows.filter((r) => `${r.category} ${r.item_name} ${r.specification ?? ''}`.toLowerCase().includes(k))
  }, [rows, keyword])

  // 需求方＝登入帳號的據點（固定，不隨品項變）。管理員無據點時才需手選。
  const myLocId: number | null = profile?.location_id ?? null
  const isAdminOrCadre = profile?.role_name === Roles.Admin || profile?.role_name === Roles.Cadre
  // 來源＝物資所在的據點（這列的據點，自動帶入）；總量不足（無所在據點）才需挑選。
  const isGlobalRow = raiseRow != null && raiseRow.locationId == null
  // 物資就在自己據點時無需向自己求援。
  const sameLocation = raiseRow != null && raiseRow.locationId != null && raiseRow.locationId === myLocId

  // 總量不足時：可挑「有此品項庫存」的其他據點（顯示現有數量）。
  const sourceOptions = useMemo(() => {
    if (!raiseRow) return [] as { locId: number; qty: number }[]
    const byLoc = new Map<number, number>()
    for (const it of items) {
      if (
        it.category === raiseRow.category &&
        it.item_name === raiseRow.item_name &&
        (it.specification ?? '') === (raiseRow.specification ?? '') &&
        it.quantity > 0 &&
        it.location_id !== myLocId
      ) {
        byLoc.set(it.location_id, (byLoc.get(it.location_id) ?? 0) + it.quantity)
      }
    }
    return [...byLoc.entries()].map(([locId, qty]) => ({ locId, qty })).sort((a, b) => b.qty - a.qty)
  }, [raiseRow, items, myLocId])

  function openRaise(row: Row) {
    setRaiseRow(row)
    setSrcLocationId('')
    setReqLocationId(profile?.location_id ? String(profile.location_id) : '')
    setReqQuantity('1')
    setReqNote('')
    setError(null)
  }

  async function submitRaise(e: FormEvent) {
    e.preventDefault()
    if (!raiseRow) return
    setError(null)
    const reqLoc = myLocId ?? (reqLocationId ? Number(reqLocationId) : null)
    const srcLoc = isGlobalRow ? (srcLocationId ? Number(srcLocationId) : null) : raiseRow.locationId
    if (!reqLoc) return setError('無法判斷你的據點，請先選擇')
    if (!srcLoc) return setError('請選擇來源據點')
    if (reqLoc === srcLoc) return setError('此物資就在你的據點，無需向自己調貨')
    const qty = Number(reqQuantity)
    if (!Number.isInteger(qty) || qty <= 0) return setError('數量必須是大於 0 的整數')

    setSaving(true)
    const { error: insErr } = await supabase.from('supply_request').insert({
      category: raiseRow.category,
      item_name: raiseRow.item_name,
      specification: raiseRow.specification,
      requesting_location_id: reqLoc,
      source_location_id: srcLoc,
      quantity: qty,
      requested_by: profile?.display_name ?? profile?.username ?? null,
      note: reqNote.trim() || null,
      status: 'Open',
    })
    setSaving(false)
    if (insErr) return setError(insErr.message)
    setRaiseRow(null)
    navigate('/', { state: { flash: `已提出需求：${raiseRow.item_name} ${qty} ${raiseRow.unit ?? ''}` } })
  }

  if (!isValidStatus(status)) {
    return (
      <div className="container-fluid mt-4">
        <div className="alert alert-warning">未知的狀態頁面。</div>
        <Link className="btn btn-secondary" to="/">
          返回戰情總覽
        </Link>
      </div>
    )
  }

  const c = statusColorMap[status]

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0">
          <span className="badge me-2" style={{ backgroundColor: c.bg, color: c.text }}>
            <i className={`bi ${c.icon}`} />
          </span>
          {c.label}
        </h2>
        <Link className="btn btn-outline-secondary" to="/">
          <i className="bi bi-arrow-left" /> 返回戰情總覽
        </Link>
      </div>
      <FlashMessage />

      <div className="card shadow-sm mb-3">
        <div className="card-body">
          <input className="form-control" placeholder="搜尋品項名稱、種類或規格" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </div>
      </div>

      <div className="card shadow-sm">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0 status-table">
              <colgroup>
                <col className="status-table-serial" /><col className="status-table-photo" /><col className="status-table-category" />
                <col className="status-table-name" /><col className="status-table-spec" /><col className="status-table-quantity" />
                <col className="status-table-location" /><col className="status-table-detail" /><col className="status-table-action" />
              </colgroup>
              <thead className="table-light"><tr>
                <th>流水號</th><th>照片</th><th>種類</th><th>名稱</th><th>規格</th><th>數量</th><th>據點</th>
                <th>{status === 'globalLowStock' ? '安全庫存' : '效期／庫存分類'}</th><th className="text-center">操作</th>
              </tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="text-center text-muted py-5">載入中…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} className="text-center text-muted py-5">目前沒有符合的項目</td></tr>
                ) : filtered.map((r) => {
                  const url = itemPhotoUrl(r.image_path)
                  return (
                    <tr key={r.key}>
                      <td className="text-muted">{r.id ?? '—'}</td>
                      <td>{url ? <img src={url} alt={r.item_name} className="status-table-image" /> : <i className="bi bi-image text-muted fs-4" />}</td>
                      <td>{r.category}</td><td className="fw-semibold">{r.item_name}</td><td>{r.specification ?? '無'}</td>
                      <td>{r.quantity ?? '—'} {r.unit ?? ''}</td>
                      <td>{r.locationId == null ? <span className="badge bg-secondary">全系統</span> : <span className="badge" style={locationColorStyle(r.locationId)}>{locationName(r.locationId)}</span>}</td>
                      <td>{r.expiration ?? (r.stock_type ? <span className={`badge ${stockTypeBadgeClass(r.stock_type)}`}>{stockTypeDisplayName(r.stock_type)}</span> : r.note ?? '—')}</td>
                      <td className="text-center">
                        {status === 'expired' ? (
                          // 已過期改成直接串接物資報廢（帶入該批次）；報廢限總管/據點管理人員。
                          isAdminOrCadre && r.id != null ? (
                            <Link className="btn btn-sm btn-dark" to={`/disposals/create?supplyItemId=${r.id}`}>
                              <i className="bi bi-trash3" /> 報廢
                            </Link>
                          ) : (
                            <span className="text-muted small">—</span>
                          )
                        ) : (
                          <button className="btn btn-sm btn-primary" onClick={() => openRaise(r)}>
                            <i className="bi bi-hand-index-thumb" /> 舉手
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-muted mb-0 mt-3">共 {filtered.length} 項</p>
        </div>
      </div>

      {/* 舉手：提出缺料需求 */}
      {raiseRow && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <form onSubmit={submitRaise}>
                <div className="modal-header">
                  <h5 className="modal-title">
                    <i className="bi bi-hand-index-thumb" /> 提出缺料需求
                  </h5>
                  <button type="button" className="btn-close" onClick={() => setRaiseRow(null)} />
                </div>
                <div className="modal-body">
                  {error && <div className="alert alert-danger">{error}</div>}
                  <div className="alert alert-light border small mb-3">
                    品項：<strong>{raiseRow.item_name}</strong>
                    {raiseRow.specification ? `／${raiseRow.specification}` : ''}（{raiseRow.category}）
                  </div>

                  <div className="mb-3">
                    <label className="form-label">需求據點（你的據點）</label>
                    {myLocId != null ? (
                      <input className="form-control" disabled value={locationName(myLocId)} />
                    ) : (
                      <select className="form-select" required value={reqLocationId} onChange={(e) => setReqLocationId(e.target.value)}>
                        <option value="">請選擇你的據點</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.location_name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="mb-3">
                    <label className="form-label">來源（物資所在）據點 *</label>
                    {isGlobalRow ? (
                      <>
                        <select className="form-select" required value={srcLocationId} onChange={(e) => setSrcLocationId(e.target.value)}>
                          <option value="">請選擇有庫存的據點</option>
                          {sourceOptions.map((s) => (
                            <option key={s.locId} value={s.locId}>
                              {locationName(s.locId)}（現有 {s.qty} {raiseRow.unit ?? ''}）
                            </option>
                          ))}
                        </select>
                        {sourceOptions.length === 0 && <div className="form-text text-danger">目前其他據點都沒有此品項的庫存。</div>}
                      </>
                    ) : (
                      <input
                        className="form-control"
                        disabled
                        value={`${locationName(raiseRow.locationId)}（現有 ${raiseRow.quantity ?? '?'} ${raiseRow.unit ?? ''}）`}
                      />
                    )}
                  </div>

                  {sameLocation && <div className="alert alert-warning py-2 small mb-3">此物資就在你的據點，無需向自己調貨。</div>}

                  <div className="mb-3">
                    <label className="form-label">需求數量 *</label>
                    <input className="form-control" type="number" min={1} required value={reqQuantity} onChange={(e) => setReqQuantity(e.target.value)} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">備註</label>
                    <textarea className="form-control" rows={2} value={reqNote} onChange={(e) => setReqNote(e.target.value)} />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setRaiseRow(null)}>
                    取消
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={saving || sameLocation || (isGlobalRow && sourceOptions.length === 0)}
                  >
                    {saving ? '送出中…' : '送出需求'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

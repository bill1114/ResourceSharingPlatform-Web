// Port of SupplyItemController + Views/SupplyItem/Index.cshtml.
// Read-only list + filters + cross-location summary. Adding stock lives on the
// dedicated 物資入庫 page (/stock-in) — the "物資入庫" button here just links
// there — so the add form has a single implementation (SupplyItemForm).
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { deleteItemPhoto, itemPhotoUrl, itemPhotoDownloadUrl, uploadReplacementPhoto } from '../lib/imageUpload'
import { Roles, StockTypes, AllStockTypes, stockTypeDisplayName, stockTypeBadgeClass } from '../lib/enums'
import { locationColorStyle } from '../lib/colors'
import { FlashMessage } from '../components/FlashMessage'
import type { SupplyItem, SupplyLocation } from '../types/db'

interface ItemSummaryRow {
  itemName: string
  locationCount: number
  totalQuantity: number
  unit: string
  hasLowStock: boolean
  nearestExpirationDate: string | null
}

function today(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function itemStatus(item: SupplyItem): { label: string; badgeClass: string } {
  if (item.quantity <= item.safety_stock) return { label: '低庫存', badgeClass: 'bg-danger' }
  if (item.expiration_date) {
    const exp = new Date(item.expiration_date)
    if (exp < today()) return { label: '已過期', badgeClass: 'bg-dark' }
    const in30 = new Date(today())
    in30.setDate(in30.getDate() + 30)
    if (exp <= in30) return { label: '即將過期', badgeClass: 'bg-warning text-dark' }
  }
  return { label: '正常', badgeClass: 'bg-success' }
}

export function SupplyItems() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const isAdminOrCadre = isAdmin || profile?.role_name === Roles.Cadre
  const [searchParams] = useSearchParams()
  const [items, setItems] = useState<SupplyItem[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 操作欄的三個彈窗：放大照片、詳細資料、編輯
  const [photoPreview, setPhotoPreview] = useState<SupplyItem | null>(null)
  const [detailsItem, setDetailsItem] = useState<SupplyItem | null>(null)
  const [editItem, setEditItem] = useState<SupplyItem | null>(null)
  const [editForm, setEditForm] = useState({ quantity: '', expirationDate: '', safetyStock: '', remark: '' })
  const [editPhoto, setEditPhoto] = useState<File | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  function openEdit(item: SupplyItem) {
    setEditItem(item)
    setEditForm({
      quantity: String(item.quantity),
      expirationDate: item.expiration_date ?? '',
      safetyStock: String(item.safety_stock),
      remark: item.remark ?? '',
    })
    setEditPhoto(null)
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editItem) return
    setEditSaving(true)
    setError(null)

    let imagePath = editItem.image_path
    if (editPhoto) {
      const { path, error: upErr } = await uploadReplacementPhoto(editPhoto, { id: editItem.id, quantity: Number(editForm.quantity) })
      if (upErr) {
        setError(`圖片上傳失敗：${upErr}`)
        setEditSaving(false)
        return
      }
      if (editItem.image_path) await deleteItemPhoto(editItem.image_path)
      imagePath = path
    }

    const { error: updErr } = await supabase
      .from('supply_item')
      .update({
        quantity: Number(editForm.quantity),
        expiration_date: editItem.stock_type === StockTypes.NoExpiry ? null : editForm.expirationDate || null,
        safety_stock: Number(editForm.safetyStock) || 0,
        remark: editForm.remark.trim() || null,
        image_path: imagePath,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editItem.id)

    setEditSaving(false)
    if (updErr) {
      setError(updErr.message)
      return
    }
    setEditItem(null)
    void load()
  }

  // 篩選條件：關鍵字、據點、種類、庫存分類（分類快速切換 pills）
  const [keyword, setKeyword] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [stockTypeFilter, setStockTypeFilter] = useState('')
  const [summaryOpen, setSummaryOpen] = useState(true)

  // 從戰情總覽「查看物資」帶入的據點篩選（?locationId=）
  useEffect(() => {
    const qLocationId = searchParams.get('locationId')
    if (qLocationId) setLocationFilter(qLocationId)
  }, [searchParams])

  async function load() {
    setLoading(true)
    const [itemsRes, locRes] = await Promise.all([
      supabase.from('supply_item').select('*').eq('is_active', true).order('id', { ascending: false }),
      supabase.from('supply_location').select('*').eq('is_active', true).order('id'),
    ])
    if (itemsRes.error) setError(itemsRes.error.message)
    setItems((itemsRes.data ?? []) as SupplyItem[])
    setLocations((locRes.data ?? []) as SupplyLocation[])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category))).sort(), [items])

  const filteredItems = useMemo(() => {
    return items.filter((i) => {
      if (locationFilter && i.location_id !== Number(locationFilter)) return false
      if (categoryFilter && i.category !== categoryFilter) return false
      if (stockTypeFilter && i.stock_type !== stockTypeFilter) return false
      if (keyword.trim()) {
        const k = keyword.trim().toLowerCase()
        const matches =
          i.item_name.toLowerCase().includes(k) ||
          i.category.toLowerCase().includes(k) ||
          (i.specification ?? '').toLowerCase().includes(k) ||
          (i.remark ?? '').toLowerCase().includes(k)
        if (!matches) return false
      }
      return true
    })
  }, [items, keyword, locationFilter, categoryFilter, stockTypeFilter])

  // 依物資統計（跨據點加總）：對目前篩選結果依物資名稱分組
  const itemSummary = useMemo<ItemSummaryRow[]>(() => {
    const groups = new Map<
      string,
      { locationIds: Set<number>; totalQuantity: number; unit: string; hasLowStock: boolean; nearestExpirationDate: string | null }
    >()
    for (const item of filteredItems) {
      let g = groups.get(item.item_name)
      if (!g) {
        g = { locationIds: new Set(), totalQuantity: 0, unit: item.unit ?? '', hasLowStock: false, nearestExpirationDate: null }
        groups.set(item.item_name, g)
      }
      g.locationIds.add(item.location_id)
      g.totalQuantity += item.quantity
      if (itemStatus(item).label === '低庫存') g.hasLowStock = true
      if (item.expiration_date && (!g.nearestExpirationDate || item.expiration_date < g.nearestExpirationDate)) {
        g.nearestExpirationDate = item.expiration_date
      }
    }
    return Array.from(groups.entries())
      .map(([itemName, g]) => ({
        itemName,
        locationCount: g.locationIds.size,
        totalQuantity: g.totalQuantity,
        unit: g.unit,
        hasLowStock: g.hasLowStock,
        nearestExpirationDate: g.nearestExpirationDate,
      }))
      .sort((a, b) => {
        if (a.nearestExpirationDate && b.nearestExpirationDate) {
          if (a.nearestExpirationDate !== b.nearestExpirationDate) return a.nearestExpirationDate < b.nearestExpirationDate ? -1 : 1
          return b.totalQuantity - a.totalQuantity
        }
        if (a.nearestExpirationDate) return -1
        if (b.nearestExpirationDate) return 1
        return b.totalQuantity - a.totalQuantity
      })
  }, [filteredItems])

  function resetFilters() {
    setKeyword('')
    setLocationFilter('')
    setCategoryFilter('')
    setStockTypeFilter('')
  }

  function locationName(id: number): string {
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  async function handleDelete(item: SupplyItem) {
    if (!confirm(`確定刪除「${item.item_name}」這筆物資嗎？`)) return
    const { error } = await supabase.from('supply_item').update({ is_active: false }).eq('id', item.id)
    if (error) {
      setError(error.message)
      return
    }
    if (item.image_path) await deleteItemPhoto(item.image_path)
    void load()
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>
          <i className="bi bi-box" /> 物資管理
        </h2>
        <Link className="btn btn-primary" to="/stock-in">
          <i className="bi bi-box-arrow-in-down" /> 物資入庫
        </Link>
      </div>

      <FlashMessage />
      {error && <div className="alert alert-danger">{error}</div>}

      {/* 分類快速切換 */}
      <div className="btn-group mb-3" role="group">
        <button
          type="button"
          className={`btn btn-sm ${stockTypeFilter === '' ? 'btn-primary' : 'btn-outline-primary'}`}
          onClick={() => setStockTypeFilter('')}
        >
          全部
        </button>
        {AllStockTypes.map((st) => (
          <button
            key={st}
            type="button"
            className={`btn btn-sm ${stockTypeFilter === st ? 'btn-primary' : 'btn-outline-primary'}`}
            onClick={() => setStockTypeFilter(st)}
          >
            {stockTypeDisplayName(st)}
          </button>
        ))}
      </div>

      {/* 篩選條件 */}
      <div className="card shadow-sm mb-3">
        <div className="card-header bg-light">
          <i className="bi bi-funnel" /> 篩選條件
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-3">
              <label className="form-label">關鍵字</label>
              <input
                className="form-control"
                placeholder="物資名稱、規格、種類、備註"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <div className="col-md-3">
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
            <div className="col-md-3">
              <label className="form-label">種類</label>
              <select className="form-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="">全部種類</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3 d-flex align-items-end">
              <button type="button" className="btn btn-secondary w-100" onClick={resetFilters}>
                <i className="bi bi-arrow-clockwise" /> 重設
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 依物資統計（跨據點加總） */}
      {itemSummary.length > 0 && (
        <div className="card shadow-sm mb-3">
          <div
            className="card-header bg-light d-flex justify-content-between align-items-center"
            style={{ cursor: 'pointer' }}
            onClick={() => setSummaryOpen((v) => !v)}
          >
            <span>
              <i className="bi bi-bar-chart" /> 依物資統計（跨據點加總，共 {itemSummary.length} 種品項）
            </span>
            <i className={`bi bi-chevron-${summaryOpen ? 'up' : 'down'}`} />
          </div>
          {summaryOpen && (
            <div className="card-body">
              <div className="table-responsive">
                <table className="table table-sm table-hover mb-0">
                  <thead>
                    <tr>
                      <th>物資名稱</th>
                      <th>分布據點數</th>
                      <th>總數量</th>
                      <th>最近效期</th>
                      <th>提醒</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemSummary.map((s) => (
                      <tr key={s.itemName}>
                        <td>
                          <strong>{s.itemName}</strong>
                        </td>
                        <td>{s.locationCount}</td>
                        <td>
                          {s.totalQuantity} {s.unit}
                        </td>
                        <td>{s.nearestExpirationDate ?? '-'}</td>
                        <td>{s.hasLowStock && <span className="badge bg-danger">含低庫存</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card shadow-sm">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead className="table-light">
                <tr>
                  <th>照片</th>
                  <th>種類</th>
                  <th>名稱</th>
                  <th>規格</th>
                  <th>數量</th>
                  <th>庫存分類</th>
                  <th>效期</th>
                  <th>據點</th>
                  <th>安全庫存</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={11} className="text-center text-muted py-4">
                      載入中…
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center text-muted py-4">
                      沒有符合條件的物資
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => {
                    const status = itemStatus(item)
                    const url = itemPhotoUrl(item.image_path)
                    return (
                      <tr key={item.id}>
                        <td>
                          {url ? (
                            <img
                              src={url}
                              alt={item.item_name}
                              style={{ width: 48, height: 48, objectFit: 'cover', cursor: 'zoom-in' }}
                              className="rounded border"
                              title="點擊放大檢視"
                              onClick={() => setPhotoPreview(item)}
                            />
                          ) : (
                            <i className="bi bi-image text-muted fs-3" />
                          )}
                        </td>
                        <td>{item.category}</td>
                        <td>
                          <strong>{item.item_name}</strong>
                        </td>
                        <td>{item.specification ?? '無'}</td>
                        <td>
                          {item.quantity} {item.unit}
                        </td>
                        <td>
                          <span className={`badge ${stockTypeBadgeClass(item.stock_type)}`}>{stockTypeDisplayName(item.stock_type)}</span>
                        </td>
                        <td>{item.expiration_date ?? '—'}</td>
                        <td>
                          <span className="badge" style={locationColorStyle(item.location_id)}>
                            {locationName(item.location_id)}
                          </span>
                        </td>
                        <td>
                          {item.safety_stock} {item.unit}
                        </td>
                        <td>
                          <span className={`badge ${status.badgeClass}`}>{status.label}</span>
                        </td>
                        <td className="text-nowrap">
                          <div className="btn-group btn-group-sm" role="group">
                            <button className="btn btn-info" title="詳細資料" onClick={() => setDetailsItem(item)}>
                              <i className="bi bi-eye" />
                            </button>
                            {isAdminOrCadre && (
                              <button className="btn btn-warning" title="編輯" onClick={() => openEdit(item)}>
                                <i className="bi bi-pencil" />
                              </button>
                            )}
                            {isAdminOrCadre && (
                              <Link className="btn btn-primary" title="物資轉移" to={`/transfers/create?supplyItemId=${item.id}`}>
                                <i className="bi bi-arrow-left-right" />
                              </Link>
                            )}
                            {isAdmin && (
                              <button className="btn btn-danger" title="刪除" onClick={() => void handleDelete(item)}>
                                <i className="bi bi-trash" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <p className="text-muted mb-0">共 {filteredItems.length} 筆物資</p>
          </div>
        </div>
      </div>

      {/* 放大照片（點縮圖開啟；此處提供下載中文檔名） */}
      {photoPreview && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.75)' }} onClick={() => setPhotoPreview(null)}>
          <div className="modal-dialog modal-lg modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {photoPreview.category}｜{photoPreview.item_name}
                  {photoPreview.specification ? `｜${photoPreview.specification}` : ''}
                </h5>
                <button type="button" className="btn-close" onClick={() => setPhotoPreview(null)} />
              </div>
              <div className="modal-body text-center bg-light">
                <img src={itemPhotoUrl(photoPreview.image_path) ?? ''} alt={photoPreview.item_name} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
              </div>
              <div className="modal-footer">
                <a className="btn btn-outline-success" href={itemPhotoDownloadUrl(photoPreview) ?? '#'} download>
                  <i className="bi bi-download" /> 下載（中文檔名）
                </a>
                <button type="button" className="btn btn-secondary" onClick={() => setPhotoPreview(null)}>
                  關閉
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 詳細資料 */}
      {detailsItem && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-eye" /> 物資詳細資料
                </h5>
                <button type="button" className="btn-close" onClick={() => setDetailsItem(null)} />
              </div>
              <div className="modal-body">
                <dl className="row mb-0">
                  <dt className="col-4">種類</dt>
                  <dd className="col-8">{detailsItem.category}</dd>
                  <dt className="col-4">名稱</dt>
                  <dd className="col-8">{detailsItem.item_name}</dd>
                  <dt className="col-4">規格</dt>
                  <dd className="col-8">{detailsItem.specification ?? '無'}</dd>
                  <dt className="col-4">數量</dt>
                  <dd className="col-8">
                    {detailsItem.quantity} {detailsItem.unit}
                  </dd>
                  <dt className="col-4">庫存分類</dt>
                  <dd className="col-8">{stockTypeDisplayName(detailsItem.stock_type)}</dd>
                  <dt className="col-4">有效期限</dt>
                  <dd className="col-8">{detailsItem.expiration_date ?? '無期限'}</dd>
                  <dt className="col-4">據點</dt>
                  <dd className="col-8">{locationName(detailsItem.location_id)}</dd>
                  <dt className="col-4">安全庫存</dt>
                  <dd className="col-8">
                    {detailsItem.safety_stock} {detailsItem.unit}
                  </dd>
                  <dt className="col-4">狀態</dt>
                  <dd className="col-8">
                    <span className={`badge ${itemStatus(detailsItem).badgeClass}`}>{itemStatus(detailsItem).label}</span>
                  </dd>
                  <dt className="col-4">備註</dt>
                  <dd className="col-8">{detailsItem.remark ?? '—'}</dd>
                </dl>
                {itemPhotoUrl(detailsItem.image_path) && (
                  <div className="text-center mt-3">
                    <img
                      src={itemPhotoUrl(detailsItem.image_path)!}
                      alt=""
                      style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain', cursor: 'zoom-in' }}
                      title="點擊放大"
                      onClick={() => {
                        setPhotoPreview(detailsItem)
                        setDetailsItem(null)
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDetailsItem(null)}>
                  關閉
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 編輯物資 */}
      {editItem && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <form onSubmit={handleEditSubmit}>
                <div className="modal-header">
                  <h5 className="modal-title">
                    <i className="bi bi-pencil" /> 編輯物資
                  </h5>
                  <button type="button" className="btn-close" onClick={() => setEditItem(null)} />
                </div>
                <div className="modal-body">
                  <div className="alert alert-light border small mb-3">
                    {editItem.category}｜{editItem.item_name}
                    {editItem.specification ? `｜${editItem.specification}` : ''}｜{locationName(editItem.location_id)}
                  </div>
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label">數量 *</label>
                      <input
                        className="form-control"
                        type="number"
                        min={0}
                        required
                        value={editForm.quantity}
                        onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })}
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">安全庫存</label>
                      <input
                        className="form-control"
                        type="number"
                        min={0}
                        value={editForm.safetyStock}
                        onChange={(e) => setEditForm({ ...editForm, safetyStock: e.target.value })}
                      />
                    </div>
                  </div>
                  {editItem.stock_type !== StockTypes.NoExpiry && (
                    <div className="mb-3">
                      <label className="form-label">有效期限</label>
                      <input
                        className="form-control"
                        type="date"
                        value={editForm.expirationDate}
                        onChange={(e) => setEditForm({ ...editForm, expirationDate: e.target.value })}
                      />
                    </div>
                  )}
                  <div className="mb-3">
                    <label className="form-label">更換圖片</label>
                    <input
                      className="form-control"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => setEditPhoto(e.target.files?.[0] ?? null)}
                    />
                    <div className="form-text">留空表示不更換</div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">備註</label>
                    <textarea className="form-control" rows={2} value={editForm.remark} onChange={(e) => setEditForm({ ...editForm, remark: e.target.value })} />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setEditItem(null)}>
                    取消
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={editSaving}>
                    {editSaving ? '儲存中…' : '儲存變更'}
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

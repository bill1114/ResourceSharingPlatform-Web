// Port of SupplyItemController + Views/SupplyItem/{Index,Create,Edit}.cshtml.
// Direct table CRUD (RLS-gated, location-scoped for non-Admin) — no Edge Function,
// per migration plan §三. Uses useCascadingCatalog for the 種類/名稱/規格 dropdowns
// and lib/imageUpload for the photo naming convention.
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { useCascadingCatalog } from '../hooks/useCascadingCatalog'
import { deleteItemPhoto, itemPhotoUrl, uploadItemPhoto } from '../lib/imageUpload'
import { Roles, StockTypes, AllStockTypes, stockTypeDisplayName, stockTypeBadgeClass } from '../lib/enums'
import { locationColorStyle } from '../lib/colors'
import type { SupplyItem, SupplyLocation, LocationInventorySafetyStock } from '../types/db'

type FormState = {
  id: number | null
  quantity: string
  expirationDate: string
  locationId: string
  remark: string
}

interface ItemSummaryRow {
  itemName: string
  locationCount: number
  totalQuantity: number
  unit: string
  hasLowStock: boolean
  nearestExpirationDate: string | null
}

const emptyForm: FormState = { id: null, quantity: '', expirationDate: '', locationId: '', remark: '' }

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
  const [searchParams] = useSearchParams()
  const [items, setItems] = useState<SupplyItem[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [safetyStocks, setSafetyStocks] = useState<LocationInventorySafetyStock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 篩選條件：關鍵字、據點、種類、庫存分類（分類快速切換 pills）
  const [keyword, setKeyword] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [stockTypeFilter, setStockTypeFilter] = useState('')
  const [summaryOpen, setSummaryOpen] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [stockType, setStockType] = useState<string>(StockTypes.HasExpiry)

  const catalog = useCascadingCatalog(stockType)

  // 從戰情總覽「查看物資」帶入的據點篩選（?locationId=）
  useEffect(() => {
    const qLocationId = searchParams.get('locationId')
    if (qLocationId) setLocationFilter(qLocationId)
  }, [searchParams])

  async function load() {
    setLoading(true)
    const [itemsRes, locRes, safetyRes] = await Promise.all([
      supabase.from('supply_item').select('*').eq('is_active', true).order('id', { ascending: false }),
      supabase.from('supply_location').select('*').eq('is_active', true).order('id'),
      supabase.from('location_inventory_safety_stock').select('*'),
    ])
    if (itemsRes.error) setError(itemsRes.error.message)
    setItems((itemsRes.data ?? []) as SupplyItem[])
    setLocations((locRes.data ?? []) as SupplyLocation[])
    setSafetyStocks((safetyRes.data ?? []) as LocationInventorySafetyStock[])
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

  function openCreate() {
    setForm(emptyForm)
    setPhotoFile(null)
    setStockType(StockTypes.HasExpiry)
    catalog.reset()
    setShowForm(true)
  }

  function resolvedSafetyStock(): number {
    if (!catalog.currentDefinition || !form.locationId) return 0
    const row = safetyStocks.find(
      (s) => s.location_id === Number(form.locationId) && s.inventory_item_definition_id === catalog.currentDefinition!.id
    )
    return row?.safety_stock ?? 0
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!catalog.currentDefinition) {
      setError('請選擇物資種類與名稱')
      return
    }
    if (!form.locationId) {
      setError('請選擇所在據點')
      return
    }
    if (stockType !== StockTypes.NoExpiry && !form.expirationDate) {
      setError('有效期物資／冷凍食品必須填寫有效期限')
      return
    }

    setSaving(true)

    let imagePath: string | null = null
    if (photoFile) {
      const { path, error: uploadError } = await uploadItemPhoto(photoFile, {
        definitionId: catalog.currentDefinition.id,
        category: catalog.currentDefinition.category,
        itemName: catalog.currentDefinition.item_name,
        specification: catalog.currentVariant?.specification ?? null,
        quantity: Number(form.quantity),
      })
      if (uploadError) {
        setError(`圖片上傳失敗：${uploadError}`)
        setSaving(false)
        return
      }
      imagePath = path
    }

    const payload = {
      category: catalog.currentDefinition.category,
      item_name: catalog.currentDefinition.item_name,
      specification: catalog.currentVariant?.specification ?? null,
      unit: catalog.currentDefinition.unit,
      stock_type: stockType,
      quantity: Number(form.quantity),
      expiration_date: stockType === StockTypes.NoExpiry ? null : form.expirationDate,
      location_id: Number(form.locationId),
      inventory_item_variant_id: catalog.variantId,
      safety_stock: resolvedSafetyStock(),
      remark: form.remark.trim() || null,
      ...(imagePath ? { image_path: imagePath } : {}),
      ...(form.id ? { updated_at: new Date().toISOString() } : {}),
    }

    const result = form.id
      ? await supabase.from('supply_item').update(payload).eq('id', form.id)
      : await supabase.from('supply_item').insert(payload)

    setSaving(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    setShowForm(false)
    void load()
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
        <button className="btn btn-primary" onClick={openCreate}>
          <i className="bi bi-plus-circle" /> 新增物資
        </button>
      </div>

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
                            <img src={url} alt={item.item_name} style={{ width: 48, height: 48, objectFit: 'cover' }} className="rounded border" />
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
                          <span className={`badge ${stockTypeBadgeClass(item.stock_type)}`}>
                            {stockTypeDisplayName(item.stock_type)}
                          </span>
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
                          {isAdmin && (
                            <button className="btn btn-sm btn-outline-danger" onClick={() => void handleDelete(item)}>
                              刪除
                            </button>
                          )}
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

      {showForm && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <form onSubmit={handleSubmit}>
                <div className="modal-header">
                  <h5 className="modal-title">新增物資</h5>
                  <button type="button" className="btn-close" onClick={() => setShowForm(false)} />
                </div>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label d-block">分類</label>
                    <div className="btn-group" role="group">
                      {AllStockTypes.map((st) => (
                        <button
                          key={st}
                          type="button"
                          className={`btn btn-outline-primary ${stockType === st ? 'active' : ''}`}
                          onClick={() => {
                            setStockType(st)
                            catalog.reset()
                          }}
                        >
                          {stockTypeDisplayName(st)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="row">
                    <div className="col-md-4 mb-3">
                      <label className="form-label">物資種類 *</label>
                      <select
                        className="form-select"
                        required
                        value={catalog.category}
                        onChange={(e) => catalog.setCategory(e.target.value)}
                      >
                        <option value="">請選擇物資種類</option>
                        {catalog.categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">物資名稱 *</label>
                      <select
                        className="form-select"
                        required
                        disabled={!catalog.category}
                        value={catalog.itemName}
                        onChange={(e) => catalog.setItemName(e.target.value)}
                      >
                        <option value="">請先選擇物資種類</option>
                        {catalog.itemNames.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">規格</label>
                      <select
                        className="form-select"
                        disabled={!catalog.itemName}
                        value={catalog.variantId ?? ''}
                        onChange={(e) => catalog.setVariantId(e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">請先選擇物資名稱</option>
                        {catalog.specVariants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.specification ?? '無規格'}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="row">
                    <div className="col-md-4 mb-3">
                      <label className="form-label">目前數量 *</label>
                      <input
                        className="form-control"
                        type="number"
                        min={0}
                        required
                        value={form.quantity}
                        onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                      />
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">單位</label>
                      <input className="form-control" disabled value={catalog.currentDefinition?.unit ?? ''} />
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">所在據點 *</label>
                      <select
                        className="form-select"
                        required
                        value={form.locationId}
                        onChange={(e) => setForm({ ...form, locationId: e.target.value })}
                      >
                        <option value="">請選擇據點</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.location_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {stockType !== StockTypes.NoExpiry && (
                    <div className="mb-3">
                      <label className="form-label">有效期限 *</label>
                      <input
                        className="form-control"
                        type="date"
                        required
                        value={form.expirationDate}
                        onChange={(e) => setForm({ ...form, expirationDate: e.target.value })}
                      />
                    </div>
                  )}

                  <div className="mb-3">
                    <label className="form-label">物資圖片</label>
                    <input
                      className="form-control"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                    />
                    <div className="form-text">支援 jpg、png、webp，大小 5MB 以內</div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label">備註</label>
                    <textarea
                      className="form-control"
                      rows={2}
                      value={form.remark}
                      onChange={(e) => setForm({ ...form, remark: e.target.value })}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>
                    取消
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? '儲存中…' : '確認新增'}
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

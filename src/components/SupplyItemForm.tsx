// Shared 物資入庫 (add supply_item) form. Create-only: inserts a new
// supply_item batch (RLS-gated, location-scoped for non-Admin), uploads the
// photo per the naming convention, and resolves safety stock from the selected
// location + definition. Extracted from SupplyItems.tsx so the standalone
// 物資入庫 page and any inline use share one implementation.
import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useCascadingCatalog } from '../hooks/useCascadingCatalog'
import { uploadItemPhoto } from '../lib/imageUpload'
import { StockTypes, AllStockTypes, stockTypeDisplayName } from '../lib/enums'
import type { SupplyLocation, LocationInventorySafetyStock } from '../types/db'

type FormState = { quantity: string; expirationDate: string; locationId: string; remark: string }
const emptyForm: FormState = { quantity: '', expirationDate: '', locationId: '', remark: '' }

export function SupplyItemForm({
  onSaved,
  onCancel,
  submitLabel = '確認入庫',
}: {
  onSaved?: (message: string) => void
  onCancel?: () => void
  submitLabel?: string
}) {
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [safetyStocks, setSafetyStocks] = useState<LocationInventorySafetyStock[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stockType, setStockType] = useState<string>(StockTypes.HasExpiry)

  const catalog = useCascadingCatalog(stockType)

  useEffect(() => {
    Promise.all([
      supabase.from('supply_location').select('*').eq('is_active', true).order('id'),
      supabase.from('location_inventory_safety_stock').select('*'),
    ]).then(([locRes, safetyRes]) => {
      setLocations((locRes.data ?? []) as SupplyLocation[])
      setSafetyStocks((safetyRes.data ?? []) as LocationInventorySafetyStock[])
    })
  }, [])

  function resolvedSafetyStock(): number {
    if (!catalog.currentDefinition || !form.locationId) return 0
    const row = safetyStocks.find(
      (s) => s.location_id === Number(form.locationId) && s.inventory_item_definition_id === catalog.currentDefinition!.id
    )
    return row?.safety_stock ?? 0
  }

  function resetForm() {
    setForm(emptyForm)
    setPhotoFile(null)
    setStockType(StockTypes.HasExpiry)
    catalog.reset()
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
    }

    const result = await supabase.from('supply_item').insert(payload)
    setSaving(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    const name = catalog.currentDefinition.item_name
    resetForm()
    onSaved?.(`「${name}」已入庫`)
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="alert alert-danger">{error}</div>}

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
          <select className="form-select" required value={catalog.category} onChange={(e) => catalog.setCategory(e.target.value)}>
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
          <select className="form-select" required value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
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
        <textarea className="form-control" rows={2} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
      </div>

      <div className="d-flex justify-content-end gap-2">
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            取消
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? '儲存中…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

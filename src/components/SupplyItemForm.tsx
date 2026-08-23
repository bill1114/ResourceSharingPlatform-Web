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

type FormState = { quantity: string; expirationDate: string; locationId: string; remark: string; donorName: string; donorContact: string }
const emptyForm: FormState = { quantity: '', expirationDate: '', locationId: '', remark: '', donorName: '', donorContact: '' }

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

    // p.15：入庫可附捐贈人資料。有填捐贈人時，先建立數量 0 的批次，再走既有
    // donation-create Edge Function 把數量補上並寫入捐贈紀錄（讓捐贈分析看得到），
    // 重用已測試過的後端、不需新增 Function；沒填則照原本直接以實際數量入庫。
    const donorName = form.donorName.trim()
    const donorContact = form.donorContact.trim()
    const asDonation = donorName.length > 0
    const fullQuantity = Number(form.quantity)

    const payload = {
      category: catalog.currentDefinition.category,
      item_name: catalog.currentDefinition.item_name,
      specification: catalog.currentVariant?.specification ?? null,
      unit: catalog.currentDefinition.unit,
      stock_type: stockType,
      quantity: asDonation ? 0 : fullQuantity,
      expiration_date: stockType === StockTypes.NoExpiry ? null : form.expirationDate,
      location_id: Number(form.locationId),
      inventory_item_variant_id: catalog.variantId,
      safety_stock: resolvedSafetyStock(),
      remark: form.remark.trim() || null,
      ...(imagePath ? { image_path: imagePath } : {}),
    }

    const result = await supabase.from('supply_item').insert(payload).select('id').single()
    if (result.error) {
      setSaving(false)
      setError(result.error.message)
      return
    }

    if (asDonation) {
      const { data, error: invokeError } = await supabase.functions.invoke('donation-create', {
        body: {
          supplyItemId: result.data.id,
          locationId: Number(form.locationId),
          donationQuantity: fullQuantity,
          donorName,
          donorContact,
          remark: form.remark.trim() || null,
        },
      })
      if (invokeError || !data?.success) {
        setSaving(false)
        setError(data?.message ?? '入庫已建立，但捐贈人紀錄寫入失敗，請至物資捐贈補登')
        return
      }
    }

    setSaving(false)
    const name = catalog.currentDefinition.item_name
    resetForm()
    onSaved?.(asDonation ? `「${name}」已入庫並記錄捐贈人` : `「${name}」已入庫`)
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

      {/* p.15：捐贈人資料（選填）。填了捐贈人姓名，本次入庫會一併記入捐贈紀錄／捐贈分析。 */}
      <div className="row">
        <div className="col-md-6 mb-3">
          <label className="form-label">捐贈人姓名</label>
          <input
            className="form-control"
            placeholder="例如：陳先生／某某企業（選填）"
            value={form.donorName}
            onChange={(e) => setForm({ ...form, donorName: e.target.value })}
          />
          <div className="form-text">填寫後，本次入庫會記入捐贈紀錄與捐贈分析。</div>
        </div>
        <div className="col-md-6 mb-3">
          <label className="form-label">捐贈者聯絡方式</label>
          <input
            className="form-control"
            placeholder="例如：手機或地址（選填）"
            value={form.donorContact}
            onChange={(e) => setForm({ ...form, donorContact: e.target.value })}
          />
        </div>
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

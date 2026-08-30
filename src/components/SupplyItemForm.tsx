// Shared 物資入庫 (add supply_item) form. Create-only: inserts a new
// supply_item batch (RLS-gated, location-scoped for non-Admin), uploads the
// photo per the naming convention, and resolves safety stock from the selected
// location + definition. Extracted from SupplyItems.tsx so the standalone
// 物資入庫 page and any inline use share one implementation.
import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useCascadingCatalog } from '../hooks/useCascadingCatalog'
import { uploadItemPhoto } from '../lib/imageUpload'
import { StockTypes, AllStockTypes, stockTypeDisplayName, Roles } from '../lib/enums'
import { useAuth } from '../hooks/useAuth'
import { ConfirmActionModal } from './ConfirmActionModal'
import { DateSelect } from './DateSelect'
import type { SupplyLocation, LocationInventorySafetyStock } from '../types/db'

type FormState = {
  quantity: string; expirationDate: string; locationId: string; remark: string
  donorName: string; donorContact: string; donorAddress: string
}
const emptyForm: FormState = {
  quantity: '', expirationDate: '', locationId: '', remark: '',
  donorName: '', donorContact: '', donorAddress: '',
}

export function SupplyItemForm({
  onSaved,
  onCancel,
  submitLabel = '確認入庫',
}: {
  onSaved?: (message: string) => void
  onCancel?: () => void
  submitLabel?: string
}) {
  const { profile } = useAuth()
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [safetyStocks, setSafetyStocks] = useState<LocationInventorySafetyStock[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stockType, setStockType] = useState<string>(StockTypes.HasExpiry)
  // 送出前確認視窗（p.13）：先驗證再跳出核對，按「確認入庫」才真正寫入。
  const [confirmOpen, setConfirmOpen] = useState(false)

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

  useEffect(() => {
    // 所有帳號（包含管理員）先帶入個人所屬據點；管理員僅是保留切換權限。
    if (profile?.location_id) {
      setForm((current) => ({ ...current, locationId: String(profile.location_id) }))
    }
  }, [profile])

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

  function handleSubmit(e: FormEvent) {
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
    if (!form.quantity || Number(form.quantity) <= 0) {
      setError('請輸入大於 0 的入庫數量')
      return
    }
    // 驗證通過：跳出確認視窗，等使用者核對後才真的入庫。
    setConfirmOpen(true)
  }

  function locationName(id: number): string {
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  async function doStockIn() {
    if (!catalog.currentDefinition) return
    setError(null)
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
        setConfirmOpen(false)
        return
      }
      imagePath = path
    }

    // 每次入庫先建立正式庫存，再留一筆可後補的來源紀錄；捐贈資料可先空白，
    // 後續於「物資捐贈」補登時只能更新來源資料，不能再次增加庫存。
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
      quantity: fullQuantity,
      expiration_date: stockType === StockTypes.NoExpiry ? null : form.expirationDate,
      location_id: Number(form.locationId),
      inventory_item_variant_id: catalog.variantId,
      safety_stock: resolvedSafetyStock(),
      remark: form.remark.trim() || null,
      created_by: profile?.display_name ?? profile?.username ?? null,
      ...(imagePath ? { image_path: imagePath } : {}),
    }

    const result = await supabase.from('supply_item').insert(payload).select('id').single()
    if (result.error) {
      setSaving(false)
      setConfirmOpen(false)
      setError(result.error.message)
      return
    }

    const { error: stockInLogError } = await supabase.from('supply_stock_in_log').insert({
      supply_item_id: result.data.id,
      location_id: Number(form.locationId),
      stock_in_quantity: fullQuantity,
      donor_name: donorName || null,
      donor_contact: donorContact || null,
      donor_address: form.donorAddress.trim() || null,
      operator: profile?.display_name ?? profile?.username ?? null,
      remark: form.remark.trim() || null,
    })
    if (stockInLogError) {
      setSaving(false)
      setConfirmOpen(false)
      setError(`入庫已建立，但入庫來源紀錄寫入失敗：${stockInLogError.message}`)
      return
    }

    setSaving(false)
    setConfirmOpen(false)
    const name = catalog.currentDefinition.item_name
    resetForm()
    onSaved?.(asDonation ? `「${name}」已入庫並記錄捐贈人` : `「${name}」已入庫，可稍後補登捐贈人資料`)
  }

  return (
    <>
    <form onSubmit={handleSubmit}>
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card shadow-sm mb-4"><div className="card-header bg-light"><i className="bi bi-geo-alt" /> 步驟一：所在據點</div><div className="card-body">
        <label className="form-label">據點 *</label>
        <select className="form-select" required disabled={profile?.role_name !== Roles.Admin} value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
          <option value="">請選擇據點</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.location_name}</option>)}
        </select>
        {profile?.role_name !== Roles.Admin && <div className="form-text">已預設為你的所屬據點；僅管理員可切換。</div>}
      </div></div>

      <div className="card shadow-sm mb-4"><div className="card-header bg-light"><i className="bi bi-box-seam" /> 步驟二：物資資訊</div><div className="card-body">

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
      </div>

      {stockType !== StockTypes.NoExpiry && (
        <div className="mb-3">
          <label className="form-label">有效期限 *</label>
          <DateSelect value={form.expirationDate} onChange={(v) => setForm({ ...form, expirationDate: v })} />
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
      </div></div>

      <div className="card shadow-sm mb-4"><div className="card-header bg-light"><i className="bi bi-person-heart" /> 步驟三：捐贈人資訊 <span className="text-muted small">（可稍後補登）</span></div><div className="card-body">
      <div className="row">
        <div className="col-md-6 mb-3">
          <label className="form-label">捐贈人姓名</label>
          <input
            className="form-control"
            placeholder="例如：陳先生／某某企業（選填）"
            value={form.donorName}
            onChange={(e) => setForm({ ...form, donorName: e.target.value })}
          />
          <div className="form-text">填寫後，本次入庫的捐贈人會出現在「捐贈分析」（含物流追蹤）。</div>
        </div>
        <div className="col-md-6 mb-3">
          <label className="form-label">捐贈者電話</label>
          <input
            className="form-control"
            placeholder="例如：0912-345-678（選填）"
            value={form.donorContact}
            onChange={(e) => setForm({ ...form, donorContact: e.target.value })}
          />
        </div>
        <div className="col-md-12 mb-3"><label className="form-label">捐贈者地址</label><input className="form-control" placeholder="例如：雲林縣斗六市…（選填）" value={form.donorAddress} onChange={(e) => setForm({ ...form, donorAddress: e.target.value })} /></div>
      </div>

      <div className="mb-3">
        <label className="form-label">備註</label>
        <textarea className="form-control" rows={2} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
      </div>
      </div></div>

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

    {confirmOpen && catalog.currentDefinition && (
      <ConfirmActionModal
        title="確認本次入庫內容"
        icon="bi-box-arrow-in-down"
        confirmLabel="確認入庫"
        submitting={saving}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void doStockIn()}
        fields={[
          { label: '入庫據點', value: locationName(Number(form.locationId)) },
          { label: '操作人員', value: profile?.display_name ?? profile?.username ?? '—' },
          { label: '捐贈人', value: form.donorName.trim() || <span className="text-muted">未填</span> },
          { label: '捐贈者電話', value: form.donorContact.trim() || <span className="text-muted">未填</span> },
          ...(form.donorAddress.trim() ? [{ label: '捐贈者地址', value: form.donorAddress.trim(), full: true }] : []),
          ...(form.remark.trim() ? [{ label: '備註', value: form.remark.trim(), full: true }] : []),
        ]}
        items={[
          {
            name: catalog.currentDefinition.item_name,
            category: catalog.currentDefinition.category,
            spec: catalog.currentVariant?.specification ?? null,
            expiration: stockType === StockTypes.NoExpiry ? null : form.expirationDate,
            quantity: Number(form.quantity),
            unit: catalog.currentDefinition.unit,
          },
        ]}
        extraHeader="入庫數量"
        warning={<>按下「確認入庫」後會<strong>立刻建立庫存</strong>。請再確認一次上面的品項與數量。</>}
      />
    )}
    </>
  )
}

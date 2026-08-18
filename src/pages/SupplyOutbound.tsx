// 物資出庫（發放）— Create 依原系統版型重建：上方即期／已過期快選面板，
// 下方左表單／右說明兩欄。挑批次的區塊與捐贈、報廢共用 StockBatchPicker。
// 寫入仍走 outbound-create Edge Function（數量異動需要真正的交易）；
// Index 只是一個受 RLS 限縮的 SELECT。
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { useItemPicker } from '../hooks/useItemPicker'
import { functionErrorMessage } from '../lib/functionError'
import { locationColorStyle } from '../lib/colors'
import { Roles } from '../lib/enums'
import { ExpiringItemsPanel, StockBatchPicker } from '../components/StockBatchPicker'
import { fetchExpiringItems } from '../lib/stockBatch'
import type { SupplyItem, SupplyLocation, SupplyOutboundLog } from '../types/db'

export function SupplyOutboundCreate() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const [searchParams] = useSearchParams()

  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [locationId, setLocationId] = useState<number | null>(profile?.location_id ?? null)
  const [stockTypeFilter, setStockTypeFilter] = useState('')
  const [expiringItems, setExpiringItems] = useState<SupplyItem[]>([])
  const [pendingItemId, setPendingItemId] = useState<number | null>(null)

  const [quantity, setQuantity] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [recipientContact, setRecipientContact] = useState('')
  const [remark, setRemark] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const picker = useItemPicker(locationId, stockTypeFilter || undefined)
  const { items: pickerItems, setCategory, setItemName, setItemId } = picker
  const selected = picker.currentItem
  const operatorName = profile?.display_name ?? profile?.username ?? ''
  const expiryScope = useMemo(() => (isAdmin ? null : profile?.location_id ?? null), [isAdmin, profile?.location_id])

  useEffect(() => {
    supabase
      .from('supply_location')
      .select('*')
      .eq('is_active', true)
      .order('id')
      .then(({ data }) => setLocations((data ?? []) as SupplyLocation[]))
  }, [])

  useEffect(() => {
    void fetchExpiringItems(expiryScope).then(setExpiringItems)
  }, [expiryScope])

  // 戰情總覽的「選擇出庫」帶 ?supplyItemId=&locationId= 進來。
  useEffect(() => {
    const qLocationId = searchParams.get('locationId')
    const qItemId = searchParams.get('supplyItemId')
    if (qLocationId) setLocationId(Number(qLocationId))
    if (qItemId) setPendingItemId(Number(qItemId))
  }, [searchParams])

  // 快選要等該據點的物資載入完成才挑得到批次，所以先記在 pendingItemId，
  // 載好後再一次把 種類／名稱／批次 帶入（三個 setter 依序呼叫即為最終值）。
  useEffect(() => {
    if (pendingItemId == null) return
    const target = pickerItems.find((x) => x.id === pendingItemId)
    if (!target) return
    setCategory(target.category)
    setItemName(target.item_name)
    setItemId(target.id)
    setPendingItemId(null)
  }, [pendingItemId, pickerItems, setCategory, setItemName, setItemId])

  function quickPick(item: SupplyItem) {
    setError(null)
    setSuccess(null)
    setStockTypeFilter('')
    setLocationId(item.location_id)
    setPendingItemId(item.id)
  }

  // 切換分類後已選的物資可能不在範圍內，直接清空已選內容。
  function changeStockType(value: string) {
    setStockTypeFilter(value)
    picker.reset()
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!locationId || !selected) {
      setError('請選擇據點與物資')
      return
    }
    const qty = Number(quantity)
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('出庫數量必須是大於 0 的整數')
      return
    }
    if (qty > selected.quantity) {
      setError(`出庫數量超過現有庫存（現有 ${selected.quantity} ${selected.unit ?? ''}）`)
      return
    }

    setSubmitting(true)
    const { data, error: invokeError } = await supabase.functions.invoke('outbound-create', {
      body: {
        supplyItemId: selected.id,
        locationId,
        outboundQuantity: qty,
        recipientName,
        recipientContact,
        remark,
      },
    })
    setSubmitting(false)

    // 失敗時要拿 Edge Function 自己的中文訊息：supabase-js 會把非 2xx 的內容
    // 換成 "non-2xx status code"，真正的原因藏在 response body 裡。
    if (invokeError || !data?.success) {
      setError(data?.message ?? (await functionErrorMessage(invokeError, '出庫失敗')))
      return
    }
    setSuccess(data.message)
    setRecipientName('')
    setRecipientContact('')
    setQuantity('')
    setRemark('')
    picker.reload()
    setExpiringItems(await fetchExpiringItems(expiryScope))
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="mb-0">
          <i className="bi bi-box-arrow-up" /> 物資出庫（發放）
        </h2>
        <Link className="btn btn-outline-secondary" to="/outbound">
          <i className="bi bi-list-ul" /> 出庫紀錄
        </Link>
      </div>
      <hr />

      <ExpiringItemsPanel
        items={expiringItems}
        locations={locations}
        title="即期／已過期物資，建議優先出庫"
        actionLabel="選擇出庫"
        onPick={quickPick}
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="row g-4">
        <div className="col-lg-8">
          <div className="card shadow-sm">
            <div className="card-body">
              <form onSubmit={handleSubmit}>
                <StockBatchPicker
                  isAdmin={isAdmin}
                  locations={locations}
                  locationId={locationId}
                  onLocationChange={setLocationId}
                  stockTypeFilter={stockTypeFilter}
                  onStockTypeChange={changeStockType}
                  picker={picker}
                />

                <div className="mb-3">
                  <label className="form-label">出庫數量 *</label>
                  <input
                    className="form-control"
                    type="number"
                    min={1}
                    max={selected?.quantity}
                    required
                    disabled={!selected}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>

                <div className="row">
                  <div className="col-md-6 mb-3">
                    <label className="form-label">領用人姓名 *</label>
                    <input
                      className="form-control"
                      required
                      maxLength={50}
                      placeholder="例如：陳先生"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                    />
                  </div>
                  <div className="col-md-6 mb-3">
                    <label className="form-label">領用人聯絡方式</label>
                    <input
                      className="form-control"
                      maxLength={50}
                      placeholder="例如：手機或地址"
                      value={recipientContact}
                      onChange={(e) => setRecipientContact(e.target.value)}
                    />
                  </div>
                </div>

                <div className="mb-3">
                  <label className="form-label">操作人員</label>
                  <input className="form-control" disabled value={operatorName} />
                  <div className="form-text">系統會自動記錄目前登入帳號為操作人員。</div>
                </div>

                <div className="mb-3">
                  <label className="form-label">備註</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    placeholder="發放原因或其他說明"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                  />
                </div>

                <div className="d-flex gap-2">
                  <button type="submit" className="btn btn-primary btn-lg" disabled={submitting || !selected}>
                    <i className="bi bi-check-circle" /> {submitting ? '處理中…' : '確認出庫'}
                  </button>
                  <Link className="btn btn-secondary btn-lg" to="/outbound">
                    ← 返回紀錄
                  </Link>
                </div>
              </form>
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="alert alert-info">
            <strong>
              <i className="bi bi-info-circle" /> 出庫說明
            </strong>
            <ul className="mb-0 mt-2">
              <li>先選擇據點，物資選單會自動只顯示該據點的物資</li>
              <li>可搭配分類快速篩選（無效期／有效期／冷凍食品）</li>
              <li>出庫後物資會直接離開系統庫存，不會轉入其他據點</li>
              <li>系統會自動檢查庫存是否足夠</li>
            </ul>
          </div>
          <div className="alert alert-warning">
            <strong>
              <i className="bi bi-exclamation-triangle" /> 注意事項
            </strong>
            <ul className="mb-0 mt-2">
              <li>請確認出庫數量正確</li>
              <li>出庫後無法直接復原</li>
              <li>建議填寫領用人聯絡方式以利後續追蹤</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SupplyOutboundIndex() {
  const [logs, setLogs] = useState<SupplyOutboundLog[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [keyword, setKeyword] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [logRes, locRes] = await Promise.all([
        supabase.from('supply_outbound_log').select('*').order('outbound_time', { ascending: false }).limit(100),
        supabase.from('supply_location').select('*'),
      ])
      setLogs((logRes.data ?? []) as SupplyOutboundLog[])
      setLocations((locRes.data ?? []) as SupplyLocation[])
      setLoading(false)
    }
    void load()
  }, [])

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (locationFilter && l.location_id !== Number(locationFilter)) return false
      if (keyword.trim()) {
        const k = keyword.trim().toLowerCase()
        if (!l.recipient_name.toLowerCase().includes(k) && !(l.recipient_contact ?? '').toLowerCase().includes(k)) return false
      }
      return true
    })
  }, [logs, keyword, locationFilter])

  function locationName(id: number): string {
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  return (
    <div className="container-fluid mt-4">
      <h2 className="mb-4">
        <i className="bi bi-list-ul" /> 物資出庫紀錄
      </h2>
      <div className="card shadow-sm mb-3">
        <div className="card-header bg-light">
          <i className="bi bi-funnel" /> 篩選條件
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label">關鍵字</label>
              <input className="form-control" placeholder="搜尋領用人姓名或聯絡方式" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
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
            <div className="col-md-3 d-flex align-items-end">
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
            <table className="table table-hover">
              <thead className="table-light">
                <tr>
                  <th>出庫時間</th>
                  <th>來源據點</th>
                  <th>出庫數量</th>
                  <th>領用人</th>
                  <th>聯絡方式</th>
                  <th>操作人員</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center text-muted py-4">
                      載入中…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-muted py-4">
                      沒有符合條件的出庫紀錄
                    </td>
                  </tr>
                ) : (
                  filtered.map((log) => (
                    <tr key={log.id}>
                      <td>{new Date(log.outbound_time).toLocaleString('zh-TW')}</td>
                      <td>
                        <span className="badge" style={locationColorStyle(log.location_id)}>
                          {locationName(log.location_id)}
                        </span>
                      </td>
                      <td className="text-end">
                        <strong>{log.outbound_quantity}</strong>
                      </td>
                      <td>{log.recipient_name}</td>
                      <td>{log.recipient_contact}</td>
                      <td>{log.operator}</td>
                      <td>{log.remark}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

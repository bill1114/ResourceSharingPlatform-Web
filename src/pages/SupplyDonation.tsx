// 物資捐贈 — Create 與出庫／報廢共用同一套版型（StockBatchPicker + 左表單右說明）。
// 捐贈沒有即期快選面板：捐進快過期的批次不是該優先做的事。
// 寫入走 donation-create Edge Function；Index 只是一個受 RLS 限縮的 SELECT。
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { useItemPicker } from '../hooks/useItemPicker'
import { functionErrorMessage } from '../lib/functionError'
import { locationColorStyle } from '../lib/colors'
import { Roles } from '../lib/enums'
import { StockBatchPicker } from '../components/StockBatchPicker'
import { FlashMessage } from '../components/FlashMessage'
import { exportToExcel } from '../lib/excelExport'
import type { SupplyItem, SupplyLocation, SupplyDonationLog } from '../types/db'

interface DonorSummaryRow {
  donor_name: string
  donor_contact: string
  pickup_count: number
  distinct_item_count: number
  first_donation_date: string
  last_donation_date: string
}

export function SupplyDonationCreate() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const navigate = useNavigate()

  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [locationId, setLocationId] = useState<number | null>(profile?.location_id ?? null)
  const [stockTypeFilter, setStockTypeFilter] = useState('')

  const [quantity, setQuantity] = useState('')
  const [donorName, setDonorName] = useState('')
  const [donorContact, setDonorContact] = useState('')
  const [remark, setRemark] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const picker = useItemPicker(locationId, stockTypeFilter || undefined)
  const selected = picker.currentItem
  const operatorName = profile?.display_name ?? profile?.username ?? ''

  useEffect(() => {
    supabase
      .from('supply_location')
      .select('*')
      .eq('is_active', true)
      .order('id')
      .then(({ data }) => setLocations((data ?? []) as SupplyLocation[]))
  }, [])

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
      setError('捐贈數量必須是大於 0 的整數')
      return
    }

    setSubmitting(true)
    const { data, error: invokeError } = await supabase.functions.invoke('donation-create', {
      body: {
        supplyItemId: selected.id,
        locationId,
        donationQuantity: qty,
        donorName,
        donorContact,
        remark,
      },
    })
    setSubmitting(false)

    // 失敗時要拿 Edge Function 自己的中文訊息：supabase-js 會把非 2xx 的內容
    // 換成 "non-2xx status code"，真正的原因藏在 response body 裡。
    if (invokeError || !data?.success) {
      setError(data?.message ?? (await functionErrorMessage(invokeError, '捐贈失敗')))
      return
    }
    navigate('/donations', { state: { flash: data.message } })
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="mb-0">
          <i className="bi bi-gift" /> 物資捐贈（入庫）
        </h2>
        <Link className="btn btn-outline-secondary" to="/donations">
          <i className="bi bi-list-ul" /> 捐贈紀錄
        </Link>
      </div>
      <hr />

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
                  <label className="form-label">捐贈數量 *</label>
                  <input
                    className="form-control"
                    type="number"
                    min={1}
                    required
                    disabled={!selected}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                  {selected && (
                    <div className="form-text">
                      入庫後將成為 {selected.quantity + (Number(quantity) || 0)} {selected.unit}
                    </div>
                  )}
                </div>

                <div className="row">
                  <div className="col-md-6 mb-3">
                    <label className="form-label">捐贈者姓名 *</label>
                    <input
                      className="form-control"
                      required
                      maxLength={50}
                      placeholder="例如：陳先生／某某企業"
                      value={donorName}
                      onChange={(e) => setDonorName(e.target.value)}
                    />
                  </div>
                  <div className="col-md-6 mb-3">
                    <label className="form-label">捐贈者聯絡方式</label>
                    <input
                      className="form-control"
                      maxLength={50}
                      placeholder="例如：手機或地址"
                      value={donorContact}
                      onChange={(e) => setDonorContact(e.target.value)}
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
                    placeholder="捐贈來源或其他說明"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                  />
                </div>

                <div className="d-flex gap-2">
                  <button type="submit" className="btn btn-primary btn-lg" disabled={submitting || !selected}>
                    <i className="bi bi-check-circle" /> {submitting ? '處理中…' : '確認捐贈'}
                  </button>
                  <Link className="btn btn-secondary btn-lg" to="/donations">
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
              <i className="bi bi-info-circle" /> 捐贈說明
            </strong>
            <ul className="mb-0 mt-2">
              <li>先選擇據點，物資選單會自動只顯示該據點的物資</li>
              <li>可搭配分類快速篩選（無效期／有效期／冷凍食品）</li>
              <li>捐贈會把數量加到選定的既有批次上</li>
              <li>全新品項或不同效期請改用「物資入庫」建立批次</li>
            </ul>
          </div>
          <div className="alert alert-warning">
            <strong>
              <i className="bi bi-exclamation-triangle" /> 注意事項
            </strong>
            <ul className="mb-0 mt-2">
              <li>請確認捐贈數量與批次效期正確</li>
              <li>建議填寫捐贈者聯絡方式以利後續致謝</li>
              <li>捐贈紀錄會計入捐贈者排行</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SupplyDonationIndex() {
  const [logs, setLogs] = useState<SupplyDonationLog[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [items, setItems] = useState<SupplyItem[]>([])
  const [donorSummary, setDonorSummary] = useState<DonorSummaryRow[]>([])
  const [keyword, setKeyword] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [logRes, locRes, itemRes, summaryRes] = await Promise.all([
        supabase.from('supply_donation_log').select('*').order('donation_time', { ascending: false }).limit(100),
        supabase.from('supply_location').select('*'),
        supabase.from('supply_item').select('id, item_name, specification, unit'),
        supabase.from('donor_leaderboard_view').select('*').order('pickup_count', { ascending: false }),
      ])
      setLogs((logRes.data ?? []) as SupplyDonationLog[])
      setLocations((locRes.data ?? []) as SupplyLocation[])
      setItems((itemRes.data ?? []) as SupplyItem[])
      setDonorSummary((summaryRes.data ?? []) as DonorSummaryRow[])
      setLoading(false)
    }
    void load()
  }, [])

  function itemOf(id: number): SupplyItem | undefined {
    return items.find((i) => i.id === id)
  }

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (locationFilter && log.location_id !== Number(locationFilter)) return false
      if (keyword.trim()) {
        const k = keyword.trim().toLowerCase()
        const matches =
          log.donor_name.toLowerCase().includes(k) ||
          (log.donor_contact ?? '').toLowerCase().includes(k) ||
          (log.operator ?? '').toLowerCase().includes(k) ||
          (itemOf(log.supply_item_id)?.item_name ?? '').toLowerCase().includes(k)
        if (!matches) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, keyword, locationFilter, items])

  function locationName(id: number): string {
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  function handleExport() {
    exportToExcel<SupplyDonationLog>('捐贈紀錄', '捐贈紀錄', [
      { header: '捐贈時間', value: (l) => new Date(l.donation_time).toLocaleString('zh-TW') },
      { header: '物資名稱', value: (l) => itemOf(l.supply_item_id)?.item_name ?? `物資 #${l.supply_item_id}` },
      { header: '規格', value: (l) => itemOf(l.supply_item_id)?.specification ?? '' },
      { header: '據點', value: (l) => locationName(l.location_id) },
      { header: '數量', value: (l) => l.donation_quantity },
      { header: '單位', value: (l) => itemOf(l.supply_item_id)?.unit ?? '' },
      { header: '捐贈者', value: (l) => l.donor_name },
      { header: '聯絡方式', value: (l) => l.donor_contact ?? '' },
      { header: '操作人員', value: (l) => l.operator ?? '' },
    ], filteredLogs)
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">
          <i className="bi bi-award" /> 捐贈紀錄
        </h2>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-success" onClick={handleExport} disabled={filteredLogs.length === 0}>
            <i className="bi bi-file-earmark-excel" /> 匯出 Excel
          </button>
          <Link className="btn btn-primary" to="/donations/create">
            <i className="bi bi-plus-circle" /> 新增捐贈登記
          </Link>
        </div>
      </div>
      <FlashMessage />

      <div className="card shadow-sm mb-3">
        <div className="card-header bg-light">
          <i className="bi bi-funnel" /> 篩選條件
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label">關鍵字</label>
              <input
                className="form-control"
                placeholder="搜尋捐贈者姓名、聯絡方式或操作人員"
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

      <div className="row g-3">
        <div className="col-md-8">
          <div className="card shadow-sm">
            <div className="card-body">
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead className="table-light">
                    <tr>
                      <th>捐贈時間</th>
                      <th>物資名稱</th>
                      <th>據點</th>
                      <th>數量</th>
                      <th>捐贈者</th>
                      <th>聯絡方式</th>
                      <th>操作人員</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="text-center text-muted py-4">
                          載入中…
                        </td>
                      </tr>
                    ) : filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center text-muted py-4">
                          沒有符合條件的捐贈紀錄
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log) => (
                        <tr key={log.id}>
                          <td>{new Date(log.donation_time).toLocaleString('zh-TW')}</td>
                          <td>
                            <strong>{itemOf(log.supply_item_id)?.item_name ?? `物資 #${log.supply_item_id}`}</strong>
                            {itemOf(log.supply_item_id)?.specification ? (
                              <span className="text-muted"> ／{itemOf(log.supply_item_id)?.specification}</span>
                            ) : null}
                          </td>
                          <td>
                            <span className="badge" style={locationColorStyle(log.location_id)}>
                              {locationName(log.location_id)}
                            </span>
                          </td>
                          <td className="text-end">
                            {log.donation_quantity} {itemOf(log.supply_item_id)?.unit ?? ''}
                          </td>
                          <td>{log.donor_name}</td>
                          <td>{log.donor_contact}</td>
                          <td>{log.operator}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="card shadow-sm">
            <div className="card-header bg-light">
              <i className="bi bi-trophy" /> 捐贈者排行
            </div>
            <div className="card-body">
              {donorSummary.length === 0 ? (
                <p className="text-muted mb-0">尚無資料</p>
              ) : (
                <ul className="list-group list-group-flush">
                  {donorSummary.map((d, i) => (
                    <li key={i} className="list-group-item d-flex justify-content-between align-items-center px-0">
                      <span>{d.donor_name}</span>
                      <span className="badge bg-primary rounded-pill">{d.pickup_count} 次</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

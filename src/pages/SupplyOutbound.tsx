// Port of SupplyOutboundController + Views/SupplyOutbound/{Create,Index}.cshtml.
// Create calls the outbound-create Edge Function (quantity mutation needs a real
// transaction); Index is a plain scoped SELECT (RLS already limits rows to the
// caller's own location unless Admin).
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { useItemPicker } from '../hooks/useItemPicker'
import { locationColorStyle } from '../lib/colors'
import { Roles } from '../lib/enums'
import type { SupplyLocation, SupplyOutboundLog } from '../types/db'

export function SupplyOutboundCreate() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const [searchParams] = useSearchParams()
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [locationId, setLocationId] = useState<number | null>(profile?.location_id ?? null)
  const [recipientName, setRecipientName] = useState('')
  const [recipientContact, setRecipientContact] = useState('')
  const [quantity, setQuantity] = useState('')
  const [remark, setRemark] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const picker = useItemPicker(locationId)

  useEffect(() => {
    supabase
      .from('supply_location')
      .select('*')
      .eq('is_active', true)
      .order('id')
      .then(({ data }) => setLocations((data ?? []) as SupplyLocation[]))
  }, [])

  // Pre-select from a ?supplyItemId=&locationId= deep link (Dashboard's 選擇出庫 shortcut).
  useEffect(() => {
    const qLocationId = searchParams.get('locationId')
    if (qLocationId) setLocationId(Number(qLocationId))
  }, [searchParams])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!locationId || !picker.itemId) {
      setError('請選擇據點與物資')
      return
    }

    setSubmitting(true)
    const { data, error } = await supabase.functions.invoke('outbound-create', {
      body: {
        supplyItemId: picker.itemId,
        locationId,
        outboundQuantity: Number(quantity),
        recipientName,
        recipientContact,
        remark,
      },
    })
    setSubmitting(false)

    if (error || !data?.success) {
      setError(data?.message ?? error?.message ?? '出庫失敗')
      return
    }
    setSuccess(data.message)
    setRecipientName('')
    setRecipientContact('')
    setQuantity('')
    setRemark('')
    picker.setItemId(null)
  }

  return (
    <div className="container mt-4">
      <h2>
        <i className="bi bi-box-arrow-up" /> 物資出庫
      </h2>
      <hr />
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="card shadow-sm">
        <div className="card-body">
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label">據點 *</label>
              {isAdmin ? (
                <select
                  className="form-select"
                  required
                  value={locationId ?? ''}
                  onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">請選擇據點</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.location_name}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="form-control" disabled value={locations.find((l) => l.id === locationId)?.location_name ?? ''} />
              )}
            </div>

            <div className="row">
              <div className="col-md-4 mb-3">
                <label className="form-label">物資種類 *</label>
                <select className="form-select" required value={picker.category} onChange={(e) => picker.setCategory(e.target.value)}>
                  <option value="">請選擇物資種類</option>
                  {picker.categories.map((c) => (
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
                  disabled={!picker.category}
                  value={picker.itemName}
                  onChange={(e) => picker.setItemName(e.target.value)}
                >
                  <option value="">請先選擇物資種類</option>
                  {picker.itemNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-4 mb-3">
                <label className="form-label">規格／批次 *</label>
                <select
                  className="form-select"
                  required
                  disabled={!picker.itemName}
                  value={picker.itemId ?? ''}
                  onChange={(e) => picker.setItemId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">請先選擇物資名稱</option>
                  {picker.batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {picker.batchLabel(b)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mb-3">
              <label className="form-label">出庫數量 *</label>
              <input
                className="form-control"
                type="number"
                min={1}
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="mb-3">
              <label className="form-label">領用人姓名 *</label>
              <input className="form-control" required value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
            </div>
            <div className="mb-3">
              <label className="form-label">聯絡方式</label>
              <input className="form-control" value={recipientContact} onChange={(e) => setRecipientContact(e.target.value)} />
            </div>
            <div className="mb-3">
              <label className="form-label">備註</label>
              <textarea className="form-control" rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>

            <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
              {submitting ? '處理中…' : '確認出庫'}
            </button>
          </form>
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

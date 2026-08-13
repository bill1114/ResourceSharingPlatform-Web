// Port of SupplyDisposalController + Views/SupplyDisposal/{Create,Index}.cshtml.
import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { useItemPicker } from '../hooks/useItemPicker'
import { locationColorStyle } from '../lib/colors'
import { Roles, AllDisposalReasons, disposalReasonDisplayName, disposalReasonBadgeClass, DisposalReasons } from '../lib/enums'
import type { SupplyLocation, SupplyDisposalLog } from '../types/db'

export function SupplyDisposalCreate() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [locationId, setLocationId] = useState<number | null>(profile?.location_id ?? null)
  const [reason, setReason] = useState<string>(DisposalReasons.Other)
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (!locationId || !picker.itemId) {
      setError('請選擇據點與物資')
      return
    }
    setSubmitting(true)
    const { data, error } = await supabase.functions.invoke('disposal-create', {
      body: { supplyItemId: picker.itemId, locationId, disposalQuantity: Number(quantity), reason, remark },
    })
    setSubmitting(false)
    if (error || !data?.success) {
      setError(data?.message ?? error?.message ?? '報廢失敗')
      return
    }
    setSuccess(data.message)
    setQuantity('')
    setRemark('')
    picker.setItemId(null)
  }

  return (
    <div className="container mt-4">
      <h2>
        <i className="bi bi-trash3" /> 物資報廢／損耗登記
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
              <label className="form-label">報廢數量 *</label>
              <input className="form-control" type="number" min={1} required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="mb-3">
              <label className="form-label">報廢原因 *</label>
              <select className="form-select" value={reason} onChange={(e) => setReason(e.target.value)}>
                {AllDisposalReasons.map((r) => (
                  <option key={r} value={r}>
                    {disposalReasonDisplayName(r)}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-3">
              <label className="form-label">備註</label>
              <textarea className="form-control" rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
              {submitting ? '處理中…' : '確認報廢'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

export function SupplyDisposalIndex() {
  const [logs, setLogs] = useState<SupplyDisposalLog[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [logRes, locRes] = await Promise.all([
        supabase.from('supply_disposal_log').select('*').order('disposal_time', { ascending: false }).limit(100),
        supabase.from('supply_location').select('*'),
      ])
      setLogs((logRes.data ?? []) as SupplyDisposalLog[])
      setLocations((locRes.data ?? []) as SupplyLocation[])
      setLoading(false)
    }
    void load()
  }, [])

  function locationName(id: number): string {
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  return (
    <div className="container-fluid mt-4">
      <h2 className="mb-4">
        <i className="bi bi-list-ul" /> 物資報廢紀錄
      </h2>
      <div className="card shadow-sm">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover">
              <thead className="table-light">
                <tr>
                  <th>報廢時間</th>
                  <th>據點</th>
                  <th>數量</th>
                  <th>原因</th>
                  <th>操作人員</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="text-center text-muted py-4">
                      載入中…
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-muted py-4">
                      尚無報廢紀錄
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id}>
                      <td>{new Date(log.disposal_time).toLocaleString('zh-TW')}</td>
                      <td>
                        <span className="badge" style={locationColorStyle(log.location_id)}>
                          {locationName(log.location_id)}
                        </span>
                      </td>
                      <td className="text-end">{log.disposal_quantity}</td>
                      <td>
                        <span className={`badge ${disposalReasonBadgeClass(log.reason)}`}>{disposalReasonDisplayName(log.reason)}</span>
                      </td>
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

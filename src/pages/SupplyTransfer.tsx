import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { locationColorStyle } from '../lib/colors'
import { Roles, TransferStatuses, transferStatusBadgeClass, transferStatusDisplayName } from '../lib/enums'
import { supabase } from '../lib/supabaseClient'
import { FlashMessage } from '../components/FlashMessage'
import type { SupplyItem, SupplyLocation, SupplyTransferLog, SupplyRequest } from '../types/db'

type TransferLine = { key: number; supplyItemId: number | null; transferQuantity: string }

export function SupplyTransferCreate() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [items, setItems] = useState<SupplyItem[]>([])
  const [fromLocationId, setFromLocationId] = useState<number | null>(profile?.location_id ?? null)
  const [toLocationId, setToLocationId] = useState<number | null>(null)
  const [lines, setLines] = useState<TransferLine[]>([{ key: 1, supplyItemId: null, transferQuantity: '' }])
  const [remark, setRemark] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('supply_location').select('*').eq('is_active', true).order('id'),
      supabase.from('supply_item').select('*').eq('is_active', true).gt('quantity', 0).order('item_name'),
    ]).then(([locRes, itemRes]) => {
      setLocations((locRes.data ?? []) as SupplyLocation[])
      setItems((itemRes.data ?? []) as SupplyItem[])
    })
  }, [])

  // 物資清單「物資轉移」按鈕帶 ?supplyItemId= 進來時，預選來源據點與該筆物資。
  useEffect(() => {
    const id = searchParams.get('supplyItemId')
    if (!id || items.length === 0) return
    const target = items.find((x) => x.id === Number(id))
    if (!target) return
    setFromLocationId(target.location_id)
    setLines([{ key: Date.now(), supplyItemId: target.id, transferQuantity: '' }])
  }, [searchParams, items])

  // 戰情總覽「待處理需求」的「轉移補貨」帶 ?requestId= 進來時：來源=需求指定的來源據點、
  // 目標=需求據點，並在來源據點找符合品項的批次、帶入需求數量。
  useEffect(() => {
    const reqId = searchParams.get('requestId')
    if (!reqId || items.length === 0) return
    let cancelled = false
    supabase
      .from('supply_request')
      .select('*')
      .eq('id', Number(reqId))
      .single()
      .then(({ data }) => {
        if (cancelled || !data) return
        const req = data as SupplyRequest
        if (req.source_location_id) setFromLocationId(req.source_location_id)
        setToLocationId(req.requesting_location_id)
        const match = items.find(
          (x) =>
            x.location_id === req.source_location_id &&
            x.category === req.category &&
            x.item_name === req.item_name &&
            (x.specification ?? '') === (req.specification ?? '')
        )
        setLines([{ key: Date.now(), supplyItemId: match ? match.id : null, transferQuantity: String(req.quantity) }])
      })
    return () => {
      cancelled = true
    }
  }, [searchParams, items])

  const sourceItems = useMemo(() => items.filter((x) => x.location_id === fromLocationId), [items, fromLocationId])

  function updateLine(key: number, patch: Partial<TransferLine>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (!fromLocationId || !toLocationId || fromLocationId === toLocationId) {
      setError('請選擇不同的來源與目標據點')
      return
    }
    if (lines.some((x) => !x.supplyItemId || Number(x.transferQuantity) <= 0)) {
      setError('請完整選擇物資並輸入正確數量')
      return
    }
    setSubmitting(true)
    const { data, error: invokeError } = await supabase.functions.invoke('transfer-create', {
      body: {
        fromLocationId,
        toLocationId,
        lines: lines.map((x) => ({ supplyItemId: x.supplyItemId, transferQuantity: Number(x.transferQuantity) })),
        remark,
      },
    })
    setSubmitting(false)
    if (invokeError || !data?.success) {
      setError(data?.message ?? invokeError?.message ?? '建立轉移失敗')
      return
    }
    navigate('/transfers', { state: { flash: data.message } })
  }

  return (
    <div className="container mt-4">
      <h2><i className="bi bi-arrow-left-right" /> 物資轉移</h2><hr />
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      <div className="row">
        <div className="col-lg-9">
          <div className="card shadow-sm"><div className="card-body">
            <form onSubmit={submit}>
              <div className="row">
                <div className="col-md-6 mb-3">
                  <label className="form-label">來源據點 *</label>
                  {isAdmin ? (
                    <select className="form-select" required value={fromLocationId ?? ''} onChange={(e) => { setFromLocationId(e.target.value ? Number(e.target.value) : null); setLines([{ key: Date.now(), supplyItemId: null, transferQuantity: '' }]) }}>
                      <option value="">請選擇來源據點</option>{locations.map((x) => <option key={x.id} value={x.id}>{x.location_name}</option>)}
                    </select>
                  ) : <input className="form-control" disabled value={locations.find((x) => x.id === fromLocationId)?.location_name ?? ''} />}
                </div>
                <div className="col-md-6 mb-3">
                  <label className="form-label">目標據點 *</label>
                  <select className="form-select" required value={toLocationId ?? ''} onChange={(e) => setToLocationId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">請選擇目標據點</option>{locations.filter((x) => x.id !== fromLocationId).map((x) => <option key={x.id} value={x.id}>{x.location_name}</option>)}
                  </select>
                </div>
              </div>
              <label className="form-label">轉移物資 *</label>
              <div className="table-responsive"><table className="table table-sm align-middle">
                <thead><tr><th>#</th><th>物資／批次</th><th style={{ width: 180 }}>數量</th><th /></tr></thead>
                <tbody>{lines.map((line, index) => <tr key={line.key}>
                  <td>{index + 1}</td>
                  <td><select className="form-select" required value={line.supplyItemId ?? ''} onChange={(e) => updateLine(line.key, { supplyItemId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">請選擇物資</option>{sourceItems.map((x) => <option key={x.id} value={x.id}>{x.category}／{x.item_name}{x.specification ? `（${x.specification}）` : ''}－現有 {x.quantity} {x.unit}</option>)}
                  </select></td>
                  <td><input className="form-control" type="number" min={1} required value={line.transferQuantity} onChange={(e) => updateLine(line.key, { transferQuantity: e.target.value })} /></td>
                  <td><button className="btn btn-outline-danger btn-sm" type="button" disabled={lines.length === 1} onClick={() => setLines((x) => x.filter((row) => row.key !== line.key))}><i className="bi bi-dash-circle" /></button></td>
                </tr>)}</tbody>
              </table></div>
              <button className="btn btn-outline-primary btn-sm mb-3" type="button" onClick={() => setLines((x) => [...x, { key: Date.now(), supplyItemId: null, transferQuantity: '' }])}><i className="bi bi-plus-circle" /> 新增一項物資</button>
              <div className="mb-3"><label className="form-label">備註</label><textarea className="form-control" rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} /></div>
              <button className="btn btn-primary btn-lg me-2" type="submit" disabled={submitting}>{submitting ? '建立中…' : '建立轉移'}</button>
              <Link className="btn btn-secondary" to="/transfers">返回紀錄</Link>
            </form>
          </div></div>
        </div>
        <div className="col-lg-3">
          <div className="alert alert-warning"><strong>到貨確認</strong><ul className="mb-0 mt-2"><li>建立時先扣除來源庫存</li><li>目標據點確認後才會入庫</li><li>取消會退回來源庫存</li></ul></div>
        </div>
      </div>
    </div>
  )
}

export function SupplyTransferIndex() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const canCreate = isAdmin || profile?.role_name === Roles.Cadre
  const [logs, setLogs] = useState<SupplyTransferLog[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [items, setItems] = useState<SupplyItem[]>([])
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'danger'; text: string } | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [logRes, locRes, itemRes] = await Promise.all([
      supabase.from('supply_transfer_log').select('*').order('transfer_time', { ascending: false }).limit(100),
      supabase.from('supply_location').select('*'),
      supabase.from('supply_item').select('*'),
    ])
    setLogs((logRes.data ?? []) as SupplyTransferLog[])
    setLocations((locRes.data ?? []) as SupplyLocation[])
    setItems((itemRes.data ?? []) as SupplyItem[])
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    return logs.filter((x) => {
      if (statusFilter && x.status !== statusFilter) return false
      if (locationFilter && x.from_location_id !== Number(locationFilter) && x.to_location_id !== Number(locationFilter)) return false
      if (k) {
        const item = items.find((i) => i.id === x.supply_item_id)
        if (![item?.item_name, x.operator, x.remark].some((v) => (v ?? '').toLowerCase().includes(k))) return false
      }
      return true
    })
  }, [logs, items, keyword, statusFilter, locationFilter])

  async function resolve(functionName: 'transfer-confirm' | 'transfer-cancel', logId: number) {
    setMessage(null)
    const { data, error } = await supabase.functions.invoke(functionName, { body: { logId } })
    if (error || !data?.success) setMessage({ type: 'danger', text: data?.message ?? error?.message ?? '操作失敗' })
    else { setMessage({ type: 'success', text: data.message }); await load() }
  }
  const locationName = (id: number) => locations.find((x) => x.id === id)?.location_name ?? `#${id}`

  return <div className="container-fluid mt-4">
    <div className="d-flex justify-content-between align-items-center mb-4"><h2><i className="bi bi-list-ul" /> 物資轉移紀錄</h2>{canCreate && <Link className="btn btn-primary" to="/transfers/create"><i className="bi bi-plus-circle" /> 新增轉移</Link>}</div>
    <FlashMessage />
    {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}
    <div className="card shadow-sm mb-3"><div className="card-header bg-light"><i className="bi bi-funnel" /> 篩選條件</div><div className="card-body"><div className="row g-3">
      <div className="col-md-4"><label className="form-label">關鍵字</label><input className="form-control" placeholder="搜尋物資名稱、操作人員或備註" value={keyword} onChange={(e) => setKeyword(e.target.value)} /></div>
      <div className="col-md-3"><label className="form-label">狀態</label><select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
        <option value="">全部狀態</option>
        {Object.values(TransferStatuses).map((s) => <option key={s} value={s}>{transferStatusDisplayName(s)}</option>)}
      </select></div>
      <div className="col-md-3"><label className="form-label">據點（來源或目標）</label><select className="form-select" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
        <option value="">全部據點</option>
        {locations.map((x) => <option key={x.id} value={x.id}>{x.location_name}</option>)}
      </select></div>
      <div className="col-md-2 d-flex align-items-end"><button type="button" className="btn btn-secondary w-100" onClick={() => { setKeyword(''); setStatusFilter(''); setLocationFilter('') }}><i className="bi bi-arrow-clockwise" /> 重設</button></div>
    </div></div></div>
    <div className="card shadow-sm"><div className="card-body"><div className="table-responsive"><table className="table table-hover align-middle">
      <thead className="table-light"><tr><th>轉移時間</th><th>物資</th><th>來源</th><th /><th>目標</th><th>數量</th><th>狀態</th><th>操作人員</th><th>備註</th><th>動作</th></tr></thead>
      <tbody>{loading ? <tr><td colSpan={10} className="text-center py-4 text-muted">載入中…</td></tr> : filtered.length === 0 ? <tr><td colSpan={10} className="text-center py-4 text-muted">沒有符合條件的轉移紀錄</td></tr> : filtered.map((log) => {
        const item = items.find((x) => x.id === log.supply_item_id)
        const canResolve = isAdmin || profile?.location_id === log.to_location_id
        return <tr key={log.id}>
          <td>{new Date(log.transfer_time).toLocaleString('zh-TW')}</td><td><strong>{item?.item_name ?? `物資 #${log.supply_item_id}`}</strong>{item?.specification && <div className="small text-muted">{item.specification}</div>}</td>
          <td><span className="badge" style={locationColorStyle(log.from_location_id)}>{locationName(log.from_location_id)}</span></td><td><i className="bi bi-arrow-right-circle text-primary" /></td><td><span className="badge" style={locationColorStyle(log.to_location_id)}>{locationName(log.to_location_id)}</span></td>
          <td><strong>{log.transfer_quantity}</strong> {item?.unit}</td><td><span className={`badge ${transferStatusBadgeClass(log.status)}`}>{transferStatusDisplayName(log.status)}</span>{log.confirmed_by && <div className="small text-muted">{log.confirmed_by}<br />{log.confirmed_at && new Date(log.confirmed_at).toLocaleString('zh-TW')}</div>}</td>
          <td>{log.operator}</td><td>{log.remark}</td><td>{log.status === TransferStatuses.Pending && canResolve && <div className="d-flex gap-1"><button className="btn btn-success btn-sm" onClick={() => void resolve('transfer-confirm', log.id)}>確認送達</button><button className="btn btn-outline-danger btn-sm" onClick={() => void resolve('transfer-cancel', log.id)}>取消</button></div>}</td>
        </tr>
      })}</tbody>
    </table></div></div></div>
  </div>
}

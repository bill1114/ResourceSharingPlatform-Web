import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { AllStockTypes, Roles, stockTypeDisplayName } from '../lib/enums'
import { supabase } from '../lib/supabaseClient'
import { functionErrorMessage } from '../lib/functionError'
import { attachSharedAiPhoto } from '../lib/imageUpload'
import { logActivity } from '../lib/activityLog'
import { DateSelect } from '../components/DateSelect'
import { FlashMessage } from '../components/FlashMessage'
import type { AIStockInLog, SupplyLocation } from '../types/db'

// 每一筆辨識結果（可編輯）；logId 對應各自的 ai_stock_in_log 列。
type AiItem = {
  logId: number
  category: string
  itemName: string
  specification: string
  quantity: number | string
  unit: string
  stockType: string
  expirationDate: string
  safetyStock: number | string
  remark: string
  confidence: number | null
}

function toItem(x: AIStockInLog): AiItem {
  return {
    logId: x.id,
    category: x.suggested_category ?? '',
    itemName: x.suggested_item_name ?? '',
    specification: x.suggested_specification ?? '',
    quantity: x.suggested_quantity ?? 1,
    unit: x.suggested_unit ?? '個',
    stockType: x.suggested_stock_type ?? 'HasExpiry',
    expirationDate: x.suggested_expiration_date ?? '',
    safetyStock: x.suggested_safety_stock ?? 0,
    remark: x.suggested_remark ?? '',
    confidence: x.confidence == null ? null : Number(x.confidence),
  }
}

export function AIStockInCreate() {
  const { profile } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const isAdmin = profile?.role_name === Roles.Admin

  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [locationId, setLocationId] = useState<number | null>(profile?.location_id ?? null)
  const [inputText, setInputText] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [items, setItems] = useState<AiItem[] | null>(null) // null = 尚未辨識（顯示輸入畫面）
  const [imageUrl, setImageUrl] = useState<string | null>(null) // 給使用者核對的照片預覽
  const [imagePath, setImagePath] = useState<string | null>(null) // ai-stockin bucket 路徑（搬移照片用）
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('supply_location').select('*').eq('is_active', true).order('id').then(({ data }) => setLocations((data ?? []) as SupplyLocation[]))
    const id = params.get('id')
    if (id) {
      // 從紀錄頁「前往確認」進來：載入單一待確認項目。
      supabase.from('ai_stock_in_log').select('*').eq('id', Number(id)).single().then(async ({ data }) => {
        if (!data) return
        const log = data as AIStockInLog
        setLocationId(log.location_id)
        setItems([toItem(log)])
        if (log.input_image_path) {
          setImagePath(log.input_image_path)
          const { data: signed } = await supabase.storage.from('ai-stockin').createSignedUrl(log.input_image_path, 600)
          if (signed?.signedUrl) setImageUrl(signed.signedUrl)
        }
      })
    }
  }, [params])

  function updateItem(logId: number, patch: Partial<AiItem>) {
    setItems((prev) => (prev ? prev.map((it) => (it.logId === logId ? { ...it, ...patch } : it)) : prev))
  }
  function removeItem(logId: number) {
    setItems((prev) => (prev && prev.length > 1 ? prev.filter((it) => it.logId !== logId) : prev))
  }

  async function recognize(e: FormEvent) {
    e.preventDefault()
    if (!locationId) { setMessage({ ok: false, text: '請選擇據點' }); return }
    setBusy(true)
    setMessage(null)
    let uploadedPath: string | undefined
    if (image) {
      if (!image.type.startsWith('image/') || image.size > 10 * 1024 * 1024) {
        setMessage({ ok: false, text: '僅支援 10MB 以下圖片' }); setBusy(false); return
      }
      const ext = image.name.split('.').pop()?.toLowerCase() || 'jpg'
      uploadedPath = `${profile?.id}/${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage.from('ai-stockin').upload(uploadedPath, image)
      if (error) { setMessage({ ok: false, text: error.message }); setBusy(false); return }
    }
    const { data, error } = await supabase.functions.invoke('ai-stockin-recognize', { body: { locationId, inputText, imagePath: uploadedPath } })
    setBusy(false)
    if (error || !data?.success) {
      setMessage({ ok: false, text: data?.message ?? await functionErrorMessage(error, '辨識失敗') })
      return
    }
    // 後端已支援多品項：回傳 logs[]（每項一列 ai_stock_in_log），舊版只回 log。
    const logs: AIStockInLog[] = Array.isArray(data.logs) && data.logs.length ? data.logs : data.log ? [data.log] : []
    setItems(logs.map(toItem))
    setImagePath(uploadedPath ?? null)
    setImageUrl(image ? URL.createObjectURL(image) : null)
    setMessage({ ok: true, text: data.message })
  }

  async function confirmAll(e: FormEvent) {
    e.preventDefault()
    if (!items || !items.length) return
    setBusy(true)
    setMessage(null)

    const confirmed: { id: number; quantity: number }[] = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const { data, error } = await supabase.functions.invoke('ai-stockin-confirm', {
        body: {
          logId: it.logId, locationId,
          category: it.category, itemName: it.itemName, specification: it.specification,
          quantity: it.quantity, unit: it.unit, stockType: it.stockType,
          expirationDate: it.stockType === 'NoExpiry' ? '' : it.expirationDate,
          safetyStock: it.safetyStock, remark: it.remark,
        },
      })
      if (error || !data?.success) {
        setBusy(false)
        setMessage({ ok: false, text: `品項 ${i + 1}「${it.itemName}」入庫失敗：${data?.message ?? await functionErrorMessage(error, '確認失敗')}（前 ${confirmed.length} 項已入庫）` })
        return
      }
      if (data.item?.id) {
        confirmed.push({ id: data.item.id, quantity: data.item.quantity })
        // 入庫來源紀錄：AI 智慧入庫也留一筆（無捐贈人），與一般入庫一致。
        await supabase.from('supply_stock_in_log').insert({
          supply_item_id: data.item.id, location_id: locationId,
          stock_in_quantity: data.item.quantity,
          operator: profile?.display_name ?? profile?.username ?? null, remark: 'AI 智慧入庫',
        })
      }
    }

    // 一張照片可能對應多筆品項：把同一張照片複製給每一筆，最後才刪除來源。
    await attachSharedAiPhoto(imagePath, confirmed)

    void logActivity({ action: 'ai_stock_in', category: '庫存異動', targetTable: 'supply_item', locationId: locationId ?? null, summary: `AI 智慧入庫確認，共 ${confirmed.length} 項`, detail: { items: items.map((it) => ({ name: it.itemName, quantity: Number(it.quantity) })) } })
    setBusy(false)
    navigate('/', { state: { flash: `AI 智慧入庫完成，共 ${confirmed.length} 項` } })
  }

  const locationName = locations.find((x) => x.id === locationId)?.location_name ?? ''

  return (
    <div className="container mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2><i className="bi bi-stars" /> AI 智慧入庫</h2>
        <Link className="btn btn-outline-secondary" to="/ai-stockin"><i className="bi bi-list-ul" /> 辨識紀錄</Link>
      </div>

      {message && <div className={`alert alert-${message.ok ? 'success' : 'danger'}`}>{message.text}</div>}

      {!items ? (
        // ── 步驟一：辨識來源 ─────────────────────────────
        <form onSubmit={recognize}>
          <div className="card shadow-sm mb-4"><div className="card-header bg-light"><i className="bi bi-geo-alt" /> 步驟一：所在據點</div><div className="card-body">
            <label className="form-label">據點 *</label>
            {isAdmin
              ? <select className="form-select" required value={locationId ?? ''} onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">請選擇據點</option>
                  {locations.map((x) => <option key={x.id} value={x.id}>{x.location_name}</option>)}
                </select>
              : <input className="form-control" disabled value={locationName} />}
            {!isAdmin && <div className="form-text">已預設為你的所屬據點；僅管理員可切換。</div>}
          </div></div>

          <div className="card shadow-sm mb-4"><div className="card-header bg-light"><i className="bi bi-camera" /> 步驟二：辨識來源（文字或照片）</div><div className="card-body">
            <div className="mb-3">
              <label className="form-label">文字描述</label>
              <textarea className="form-control" rows={3} placeholder="例如：白米 10 包，每包 2 公斤，2027-01-01 到期；礦泉水 2 箱" value={inputText} onChange={(e) => setInputText(e.target.value)} />
              <div className="form-text">可一次描述多項物資；系統會逐項辨識。</div>
            </div>
            <div className="mb-3">
              <label className="form-label">或上傳照片</label>
              <input className="form-control" type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] ?? null; setImage(f); setImageUrl(f ? URL.createObjectURL(f) : null) }} />
              <div className="form-text">一張照片若有多項物資，會自動拆成多筆逐項核對。</div>
            </div>
            {imageUrl && (
              <div className="text-center">
                <img src={imageUrl} alt="待辨識照片" style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain' }} className="border rounded" />
              </div>
            )}
          </div></div>

          <div className="d-flex justify-content-end">
            <button className="btn btn-primary btn-lg" disabled={busy || (!inputText.trim() && !image)}>
              {busy ? '辨識中…' : '開始辨識'}
            </button>
          </div>
        </form>
      ) : (
        // ── 步驟三：人工核對（可多品項）───────────────────
        <form onSubmit={confirmAll}>
          <div className="row">
            <div className="col-lg-8">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h5 className="mb-0"><i className="bi bi-check2-square" /> 人工核對辨識結果</h5>
                <span className="text-muted small">共 {items.length} 筆品項（入庫據點：{locationName}）</span>
              </div>

              {items.map((it, idx) => (
                <div key={it.logId} className="card shadow-sm mb-3">
                  <div className="card-header bg-light d-flex justify-content-between align-items-center">
                    <span>
                      <i className="bi bi-box" /> 品項 {idx + 1}
                      {it.confidence != null && <span className={`badge ms-2 bg-${it.confidence >= 0.7 ? 'success' : it.confidence >= 0.5 ? 'warning text-dark' : 'secondary'}`}>信心 {Math.round(it.confidence * 100)}%</span>}
                    </span>
                    {items.length > 1 && (
                      <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeItem(it.logId)}>
                        <i className="bi bi-trash" /> 不入庫此項
                      </button>
                    )}
                  </div>
                  <div className="card-body">
                    <div className="row g-3">
                      <ItemField label="物資種類" value={it.category} onChange={(v) => updateItem(it.logId, { category: v })} />
                      <ItemField label="物資名稱" value={it.itemName} onChange={(v) => updateItem(it.logId, { itemName: v })} />
                      <ItemField label="規格" required={false} value={it.specification} onChange={(v) => updateItem(it.logId, { specification: v })} />
                      <ItemField label="數量" type="number" value={it.quantity} onChange={(v) => updateItem(it.logId, { quantity: v })} />
                      <ItemField label="單位" value={it.unit} onChange={(v) => updateItem(it.logId, { unit: v })} />
                      <div className="col-md-6">
                        <label className="form-label">庫存分類</label>
                        <select className="form-select" value={it.stockType} onChange={(e) => updateItem(it.logId, { stockType: e.target.value })}>
                          {AllStockTypes.map((x) => <option key={x} value={x}>{stockTypeDisplayName(x)}</option>)}
                        </select>
                      </div>
                      {it.stockType !== 'NoExpiry' && (
                        <div className="col-md-6">
                          <label className="form-label">有效期限 *</label>
                          <DateSelect value={it.expirationDate} onChange={(v) => updateItem(it.logId, { expirationDate: v })} />
                        </div>
                      )}
                      <ItemField label="安全庫存" required={false} type="number" value={it.safetyStock} onChange={(v) => updateItem(it.logId, { safetyStock: v })} />
                      <div className="col-12">
                        <label className="form-label">備註</label>
                        <textarea className="form-control" rows={1} value={it.remark} onChange={(e) => updateItem(it.logId, { remark: e.target.value })} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              <div className="d-flex justify-content-end gap-2">
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setItems(null); setMessage(null) }}>重新辨識</button>
                <button className="btn btn-success" disabled={busy}>{busy ? '入庫中…' : `確認並正式入庫（${items.length} 項）`}</button>
              </div>
            </div>

            <div className="col-lg-4">
              {imageUrl && (
                <div className="card shadow-sm mb-3">
                  <div className="card-header bg-light"><i className="bi bi-image" /> 辨識照片</div>
                  <div className="card-body text-center">
                    <img src={imageUrl} alt="辨識照片" style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain' }} className="rounded" />
                    <div className="form-text mt-2">請對照照片核對上面每一筆品項。</div>
                  </div>
                </div>
              )}
              <div className="alert alert-warning">請務必核對每一筆的品項、數量、效期。只有按下「確認並正式入庫」後才會寫入正式庫存。</div>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

function ItemField({ label, value, onChange, type = 'text', required = true }: { label: string; value: string | number; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div className="col-md-6">
      <label className="form-label">{label}{required ? ' *' : ''}</label>
      <input className="form-control" required={required} type={type} min={type === 'number' ? 0 : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

export function AIStockInIndex(){const[logs,setLogs]=useState<AIStockInLog[]>([]),[locations,setLocations]=useState<SupplyLocation[]>([]),[keyword,setKeyword]=useState(''),[locationFilter,setLocationFilter]=useState(''),[statusFilter,setStatusFilter]=useState<''|'confirmed'|'pending'>('');useEffect(()=>{Promise.all([supabase.from('ai_stock_in_log').select('*').order('created_at',{ascending:false}).limit(100),supabase.from('supply_location').select('*')]).then(([a,b])=>{setLogs((a.data??[])as AIStockInLog[]);setLocations((b.data??[])as SupplyLocation[])})},[]);const rows=useMemo(()=>{const k=keyword.toLowerCase();return logs.filter(x=>(!locationFilter||x.location_id===Number(locationFilter))&&(!statusFilter||(statusFilter==='confirmed'?x.is_confirmed:!x.is_confirmed))&&`${x.suggested_item_name??''} ${x.input_text??''} ${x.operator??''}`.toLowerCase().includes(k))},[logs,keyword,locationFilter,statusFilter]);function resetFilters(){setKeyword('');setLocationFilter('');setStatusFilter('')}return <div className="container-fluid mt-4"><div className="d-flex justify-content-between"><h2><i className="bi bi-stars"/> AI 智慧入庫紀錄</h2><Link className="btn btn-primary" to="/ai-stockin/create">新增辨識</Link></div><FlashMessage/><div className="card my-3"><div className="card-header bg-light"><i className="bi bi-funnel" /> 篩選條件</div><div className="card-body"><div className="row g-3">
  <div className="col-md-5"><label className="form-label">關鍵字</label><input className="form-control" placeholder="搜尋物資、描述或操作人員" value={keyword} onChange={(e)=>setKeyword(e.target.value)}/></div>
  <div className="col-md-3"><label className="form-label">據點</label><select className="form-select" value={locationFilter} onChange={(e)=>setLocationFilter(e.target.value)}><option value="">全部據點</option>{locations.map(l=><option key={l.id} value={l.id}>{l.location_name}</option>)}</select></div>
  <div className="col-md-3"><label className="form-label">狀態</label><select className="form-select" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value as ''|'confirmed'|'pending')}><option value="">全部</option><option value="confirmed">已確認</option><option value="pending">待確認</option></select></div>
  <div className="col-md-1 d-flex align-items-end"><button type="button" className="btn btn-secondary w-100" onClick={resetFilters} title="重設"><i className="bi bi-arrow-clockwise" /></button></div>
</div></div></div><div className="card"><div className="table-responsive"><table className="table table-hover mb-0"><thead><tr><th>時間</th><th>據點</th><th>輸入</th><th>建議品項</th><th>信心</th><th>狀態</th><th>操作人員</th><th/></tr></thead><tbody>{rows.map(x=><tr key={x.id}><td>{new Date(x.created_at).toLocaleString('zh-TW')}</td><td>{locations.find(l=>l.id===x.location_id)?.location_name}</td><td>{x.input_type==='Image'?'照片':x.input_text}</td><td>{x.suggested_item_name}</td><td>{x.confidence==null?'-':`${Math.round(Number(x.confidence)*100)}%`}</td><td><span className={`badge bg-${x.is_confirmed?'success':'secondary'}`}>{x.is_confirmed?'已確認':'待確認'}</span></td><td>{x.operator}</td><td>{!x.is_confirmed&&<Link className="btn btn-outline-primary btn-sm" to={`/ai-stockin/create?id=${x.id}`}>前往確認</Link>}</td></tr>)}</tbody></table></div></div></div>}

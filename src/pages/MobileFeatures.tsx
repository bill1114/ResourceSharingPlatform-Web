import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Roles, stockTypeDisplayName } from '../lib/enums'
import { supabase } from '../lib/supabaseClient'
import type { SupplyItem, SupplyLocation } from '../types/db'

const features = [
  { path: '/mobile/inventory', icon: 'bi-search', title: '物資查詢', description: '依據點查詢目前可用庫存與效期', color: 'primary' },
  { path: '/mobile/pickup', icon: 'bi-bag-check', title: '物資領用', description: '選擇物資批次並登記領用資訊', color: 'success' },
  { path: '/mobile/transfer', icon: 'bi-arrow-left-right', title: '物資轉讓', description: '建立據點間轉移並追蹤確認狀態', color: 'warning', restricted: true },
  { path: '/mobile/vision', icon: 'bi-camera', title: '影像辨識入庫', description: '拍照辨識，人工核對後才正式入庫', color: 'info', restricted: true },
]

export function MobileFeatures() {
  const { profile } = useAuth()
  const canManage = profile?.role_name === Roles.Admin || profile?.role_name === Roles.Cadre
  return <div className="container py-4" style={{ maxWidth: 720 }}>
    <div className="text-center mb-4"><div className="display-6"><i className="bi bi-phone" /></div><h2>手機網頁功能</h2><p className="text-muted">LINE 圖文選單四項功能的工程預覽版</p></div>
    <div className="row g-3">{features.map((feature) => {
      const unavailable = feature.restricted && !canManage
      return <div className="col-12 col-sm-6" key={feature.path}><div className={`card h-100 shadow-sm ${unavailable ? 'opacity-50' : ''}`}><div className="card-body d-flex flex-column">
        <div className={`rounded-circle bg-${feature.color} bg-opacity-10 text-${feature.color} d-flex align-items-center justify-content-center mb-3`} style={{ width: 52, height: 52 }}><i className={`bi ${feature.icon} fs-4`} /></div>
        <h5>{feature.title}</h5><p className="text-muted flex-grow-1">{feature.description}</p>
        {unavailable ? <button className="btn btn-secondary" disabled>目前角色不可使用</button> : <Link className={`btn btn-${feature.color}`} to={feature.path}>開啟功能</Link>}
      </div></div></div>
    })}</div>
    <div className="alert alert-secondary mt-4 small"><i className="bi bi-info-circle" /> 此頁只在工程模式顯示。正式串接 LINE／LIFF 前，會再把登入與手機導覽調整為獨立流程。</div>
  </div>
}

export function MobileInventory() {
  const { profile } = useAuth()
  const [items, setItems] = useState<SupplyItem[]>([]), [locations, setLocations] = useState<SupplyLocation[]>([])
  const [locationId, setLocationId] = useState<number | null>(profile?.location_id ?? null), [keyword, setKeyword] = useState(''), [loading, setLoading] = useState(true)
  useEffect(() => { Promise.all([supabase.from('supply_item').select('*').eq('is_active', true).gt('quantity', 0).order('item_name'), supabase.from('supply_location').select('*').eq('is_active', true).order('id')]).then(([a,b]) => { setItems((a.data ?? []) as SupplyItem[]); setLocations((b.data ?? []) as SupplyLocation[]); setLoading(false) }) }, [])
  const visible = useMemo(() => items.filter((x) => (!locationId || x.location_id === locationId) && `${x.category} ${x.item_name} ${x.specification ?? ''}`.toLowerCase().includes(keyword.toLowerCase())), [items, locationId, keyword])
  return <div className="container py-3" style={{ maxWidth: 720 }}>
    <div className="d-flex align-items-center gap-2 mb-3"><Link to="/engineering/mobile-features" className="btn btn-outline-secondary btn-sm"><i className="bi bi-chevron-left" /></Link><h3 className="mb-0">物資查詢</h3></div>
    <div className="card shadow-sm mb-3"><div className="card-body"><select className="form-select mb-2" value={locationId ?? ''} onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : null)}><option value="">全部可見據點</option>{locations.map(x => <option value={x.id} key={x.id}>{x.location_name}</option>)}</select><input className="form-control" placeholder="搜尋物資名稱、種類或規格" value={keyword} onChange={(e) => setKeyword(e.target.value)} /></div></div>
    {loading ? <div className="text-center py-5 text-muted">載入中…</div> : visible.length === 0 ? <div className="alert alert-info">目前沒有符合的可用物資</div> : <div className="d-grid gap-2">{visible.map(item => <div className="card shadow-sm" key={item.id}><div className="card-body"><div className="d-flex justify-content-between gap-3"><div><div className="small text-muted">{item.category}</div><h5 className="mb-1">{item.item_name}</h5>{item.specification && <div className="small">{item.specification}</div>}</div><div className="text-end"><div className="fs-4 fw-bold text-primary">{item.quantity}</div><div>{item.unit}</div></div></div><hr className="my-2" /><div className="d-flex justify-content-between small text-muted"><span>{stockTypeDisplayName(item.stock_type)}</span><span>{item.expiration_date ? `效期 ${item.expiration_date}` : '無效期'}</span></div></div></div>)}</div>}
  </div>
}

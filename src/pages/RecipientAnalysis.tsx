import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

interface Row { recipient_name: string; recipient_contact: string; pickup_count: number; distinct_item_count: number; first_pickup_date: string; last_pickup_date: string }

export function RecipientAnalysis() {
  const [rows, setRows] = useState<Row[]>([])
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => { supabase.from('recipient_analysis_view').select('*').order('pickup_count', { ascending: false }).then(({ data }) => { setRows((data ?? []) as Row[]); setLoading(false) }) }, [])
  const filtered = useMemo(() => { const k = keyword.trim().toLowerCase(); return k ? rows.filter((x) => `${x.recipient_name} ${x.recipient_contact}`.toLowerCase().includes(k)) : rows }, [rows, keyword])
  return <div className="container-fluid mt-4">
    <h2 className="mb-4"><i className="bi bi-graph-up" /> 領取分析</h2>
    <div className="row g-3 mb-4">
      <div className="col-md-4"><div className="card shadow-sm"><div className="card-body"><div className="text-muted">領用人數</div><div className="fs-2 fw-bold">{rows.length}</div></div></div></div>
      <div className="col-md-4"><div className="card shadow-sm"><div className="card-body"><div className="text-muted">領取總次數</div><div className="fs-2 fw-bold">{rows.reduce((a, x) => a + Number(x.pickup_count), 0)}</div></div></div></div>
      <div className="col-md-4"><div className="card shadow-sm"><div className="card-body"><div className="text-muted">平均領取次數</div><div className="fs-2 fw-bold">{rows.length ? (rows.reduce((a, x) => a + Number(x.pickup_count), 0) / rows.length).toFixed(1) : '0'}</div></div></div></div>
    </div>
    <div className="card shadow-sm mb-3"><div className="card-body"><input className="form-control" placeholder="搜尋領用人或聯絡方式" value={keyword} onChange={(e) => setKeyword(e.target.value)} /></div></div>
    <div className="card shadow-sm"><div className="table-responsive"><table className="table table-hover mb-0"><thead className="table-light"><tr><th>排名</th><th>領用人</th><th>聯絡方式</th><th>領取次數</th><th>不同物資</th><th>首次領取</th><th>最近領取</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={7} className="text-center py-4">載入中…</td></tr> : filtered.map((x, i) => <tr key={`${x.recipient_name}-${x.recipient_contact}`}><td>{i + 1}</td><td><strong>{x.recipient_name}</strong></td><td>{x.recipient_contact}</td><td>{x.pickup_count}</td><td>{x.distinct_item_count}</td><td>{new Date(x.first_pickup_date).toLocaleDateString('zh-TW')}</td><td>{new Date(x.last_pickup_date).toLocaleDateString('zh-TW')}</td></tr>)}
    </tbody></table></div></div>
  </div>
}

// 分工單 p.14：物資入庫對應的「捐贈分析」，對照 SupplyOutbound 的「領取分析」。
// 上半部沿用 donor_leaderboard_view（與領取分析同一套彙總邏輯）；下半部點選捐贈人
// 可展開其捐贈明細（捐了什麼、幾筆、目前所在據點），作為「愛心物資流向」的第一版。
// 完整「發放給誰」的流向追蹤（捐贈→出庫串接）目前沒有直接關聯，列為後續強化。
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { locationColorStyle } from '../lib/colors'

interface Row {
  donor_name: string
  donor_contact: string
  pickup_count: number
  distinct_item_count: number
  first_donation_date: string
  last_donation_date: string
}

interface DonationDetail {
  id: number
  donation_quantity: number
  donation_time: string
  remark: string | null
  location_id: number
  supply_item: { item_name: string; category: string; specification: string | null; unit: string | null } | null
}

export function DonorAnalysis() {
  const [rows, setRows] = useState<Row[]>([])
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(true)

  // 展開中的捐贈人明細
  const [openDonor, setOpenDonor] = useState<Row | null>(null)
  const [details, setDetails] = useState<DonationDetail[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [locations, setLocations] = useState<Record<number, string>>({})

  useEffect(() => {
    Promise.all([
      supabase.from('donor_leaderboard_view').select('*').order('pickup_count', { ascending: false }),
      supabase.from('supply_location').select('id, location_name'),
    ]).then(([donRes, locRes]) => {
      setRows((donRes.data ?? []) as Row[])
      const map: Record<number, string> = {}
      for (const l of (locRes.data ?? []) as { id: number; location_name: string }[]) map[l.id] = l.location_name
      setLocations(map)
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    return k ? rows.filter((x) => `${x.donor_name} ${x.donor_contact}`.toLowerCase().includes(k)) : rows
  }, [rows, keyword])

  async function toggleDonor(row: Row) {
    if (openDonor && openDonor.donor_name === row.donor_name && openDonor.donor_contact === row.donor_contact) {
      setOpenDonor(null)
      setDetails([])
      return
    }
    setOpenDonor(row)
    setDetailLoading(true)
    let q = supabase
      .from('supply_donation_log')
      .select('id, donation_quantity, donation_time, remark, location_id, supply_item(item_name, category, specification, unit)')
      .eq('donor_name', row.donor_name)
      .order('donation_time', { ascending: false })
    // donor_contact 在 view 內以空字串代表 NULL；還原成對資料表的查詢條件
    q = row.donor_contact ? q.eq('donor_contact', row.donor_contact) : q.is('donor_contact', null)
    const { data } = await q
    setDetails((data ?? []) as unknown as DonationDetail[])
    setDetailLoading(false)
  }

  const totalDonations = rows.reduce((a, x) => a + Number(x.pickup_count), 0)

  return (
    <div className="container-fluid mt-4">
      <h2 className="mb-4">
        <i className="bi bi-heart" /> 捐贈分析
      </h2>

      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <div className="card shadow-sm">
            <div className="card-body">
              <div className="text-muted">捐贈人數</div>
              <div className="fs-2 fw-bold">{rows.length}</div>
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="card shadow-sm">
            <div className="card-body">
              <div className="text-muted">捐贈總筆數</div>
              <div className="fs-2 fw-bold">{totalDonations}</div>
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="card shadow-sm">
            <div className="card-body">
              <div className="text-muted">平均捐贈筆數</div>
              <div className="fs-2 fw-bold">{rows.length ? (totalDonations / rows.length).toFixed(1) : '0'}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card shadow-sm mb-3">
        <div className="card-header bg-light">
          <i className="bi bi-funnel" /> 篩選條件
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-10">
              <label className="form-label">關鍵字</label>
              <input className="form-control" placeholder="搜尋捐贈人或聯絡方式" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="col-md-2 d-flex align-items-end">
              <button type="button" className="btn btn-secondary w-100" onClick={() => setKeyword('')}>
                <i className="bi bi-arrow-clockwise" /> 重設
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card shadow-sm">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th>排名</th>
                <th>捐贈人</th>
                <th>聯絡方式</th>
                <th>捐贈筆數</th>
                <th>不同物資</th>
                <th>首次捐贈</th>
                <th>最近捐贈</th>
                <th>物品流向</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-4">
                    載入中…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-muted py-4">
                    目前沒有捐贈紀錄
                  </td>
                </tr>
              ) : (
                filtered.map((x, i) => {
                  const isOpen = openDonor?.donor_name === x.donor_name && openDonor?.donor_contact === x.donor_contact
                  return (
                    <Fragment key={`${x.donor_name}-${x.donor_contact}`}>
                      <tr>
                        <td>{i + 1}</td>
                        <td>
                          <strong>{x.donor_name}</strong>
                        </td>
                        <td>{x.donor_contact || '—'}</td>
                        <td>{x.pickup_count}</td>
                        <td>{x.distinct_item_count}</td>
                        <td>{new Date(x.first_donation_date).toLocaleDateString('zh-TW')}</td>
                        <td>{new Date(x.last_donation_date).toLocaleDateString('zh-TW')}</td>
                        <td>
                          <button className="btn btn-sm btn-outline-primary" onClick={() => void toggleDonor(x)}>
                            <i className={`bi bi-chevron-${isOpen ? 'up' : 'down'}`} /> {isOpen ? '收合' : '查看'}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={8} className="bg-light">
                            {detailLoading ? (
                              <div className="text-center py-2 text-muted">載入明細…</div>
                            ) : details.length === 0 ? (
                              <div className="text-center py-2 text-muted">沒有可顯示的捐贈明細</div>
                            ) : (
                              <table className="table table-sm mb-0">
                                <thead>
                                  <tr>
                                    <th>捐贈日期</th>
                                    <th>物資</th>
                                    <th>數量</th>
                                    <th>捐入據點</th>
                                    <th>備註</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {details.map((d) => (
                                    <tr key={d.id}>
                                      <td>{new Date(d.donation_time).toLocaleDateString('zh-TW')}</td>
                                      <td>
                                        {d.supply_item ? (
                                          <>
                                            <strong>{d.supply_item.item_name}</strong>
                                            {d.supply_item.specification ? <span className="text-muted">／{d.supply_item.specification}</span> : null}
                                            <span className="text-muted">（{d.supply_item.category}）</span>
                                          </>
                                        ) : (
                                          '—'
                                        )}
                                      </td>
                                      <td>
                                        {d.donation_quantity} {d.supply_item?.unit ?? ''}
                                      </td>
                                      <td>
                                        <span className="badge" style={locationColorStyle(d.location_id)}>
                                          {locations[d.location_id] ?? `#${d.location_id}`}
                                        </span>
                                      </td>
                                      <td>{d.remark ?? '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

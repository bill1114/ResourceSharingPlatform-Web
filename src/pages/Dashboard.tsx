// Port of DashboardController + DashboardService + Views/Dashboard/Index.cshtml.
// All aggregates read from the shared views (supply_item_resolved,
// location_low_stock_view, global_low_stock_view) instead of duplicating the
// resolution logic here — see migration plan §一.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { locationColorStyle } from '../lib/colors'
import { statusColorMap, statusCardStyle, AllDashboardStatuses, type DashboardStatusKey } from '../lib/statusColors'
import { FlashMessage } from '../components/FlashMessage'
import { useAuth } from '../hooks/useAuth'
import { Roles } from '../lib/enums'
import { functionErrorMessage } from '../lib/functionError'
import { logActivity } from '../lib/activityLog'
import type { SupplyLocation, SupplyRequest } from '../types/db'

// 戰情總覽全域彙總（分工單 #2/#3）：改讀 dashboard_location_status /
// dashboard_summary（SECURITY DEFINER、只回統計數字），讓全部角色看到一致的
// 全部據點狀態，不再受「非總管只看自己據點」的 RLS 影響。
interface LocationStatusRow {
  location_id: number
  location_name: string
  is_active: boolean
  item_type_count: number
  total_quantity: number
  low_stock_count: number
  expiring_soon_count: number
  expired_count: number
}

interface SummaryRow {
  low_stock_total: number
  expiring_total: number
  expired_total: number
  global_low_total: number
}

interface LocationSummary {
  locationId: number
  locationName: string
  itemTypeCount: number
  totalQuantity: number
  lowStockCount: number
  expiringSoonCount: number
}

export function Dashboard() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const isAdminOrCadre = isAdmin || profile?.role_name === Roles.Cadre
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [lowStockItemCount, setLowStockItemCount] = useState(0)
  const [globalLowStockCount, setGlobalLowStockCount] = useState(0)
  const [expiringSoonCount, setExpiringSoonCount] = useState(0)
  const [expiredCount, setExpiredCount] = useState(0)
  const [locationSummaries, setLocationSummaries] = useState<LocationSummary[]>([])
  const [requests, setRequests] = useState<SupplyRequest[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
      setLoading(true)

      const [statusRes, summaryRes, locRes, reqRes] = await Promise.all([
        supabase.from('dashboard_location_status').select('*').order('location_id'),
        supabase.from('dashboard_summary').select('*').maybeSingle(),
        supabase.from('supply_location').select('*'),
        supabase.from('supply_request').select('*').eq('status', 'Open').order('created_at', { ascending: false }),
      ])

      const statusRows = (statusRes.data ?? []) as LocationStatusRow[]
      const summary = (summaryRes.data ?? null) as SummaryRow | null

      setLocations((locRes.data ?? []) as SupplyLocation[])
      setLowStockItemCount(summary?.low_stock_total ?? 0)
      setGlobalLowStockCount(summary?.global_low_total ?? 0)
      setExpiringSoonCount(summary?.expiring_total ?? 0)
      setExpiredCount(summary?.expired_total ?? 0)
      setRequests((reqRes.data ?? []) as SupplyRequest[])

      // 各據點統計：只列使用中的據點，數字全域一致（不受角色 RLS 影響）。
      setLocationSummaries(
        statusRows
          .filter((r) => r.is_active)
          .map((r) => ({
            locationId: r.location_id,
            locationName: r.location_name,
            itemTypeCount: r.item_type_count,
            totalQuantity: r.total_quantity,
            lowStockCount: r.low_stock_count,
            expiringSoonCount: r.expiring_soon_count,
          }))
      )

      setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  async function markRequest(id: number, status: 'Fulfilled' | 'Cancelled') {
    await supabase.from('supply_request').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    void logActivity({ action: status === 'Fulfilled' ? 'request_fulfill' : 'request_cancel', category: '申請', targetTable: 'supply_request', targetId: id, summary: `需求 #${id} 標記為${status === 'Fulfilled' ? '完成' : '取消/駁回'}` })
    void load()
  }

  // 總管核准「報廢申請」：實際執行報廢（走 disposal-create），成功後把申請標記完成。
  async function approveDisposal(r: SupplyRequest) {
    if (!r.supply_item_id) return
    if (!confirm(`核准並報廢「${r.item_name}」${r.quantity} 件（已過期）？此動作會扣除庫存。`)) return
    const { data, error } = await supabase.functions.invoke('disposal-create', {
      body: {
        supplyItemId: r.supply_item_id,
        locationId: r.requesting_location_id,
        disposalQuantity: r.quantity,
        reason: 'Expired',
        remark: `核准幫主報廢申請（${r.requested_by ?? ''}）`,
      },
    })
    if (error || !data?.success) {
      alert(data?.message ?? (await functionErrorMessage(error, '報廢失敗')))
      return
    }
    void logActivity({ action: 'request_approve_disposal', category: '庫存異動', targetTable: 'supply_item', targetId: r.supply_item_id, locationId: r.requesting_location_id, summary: `核准報廢「${r.item_name}」${r.quantity} 件（已過期）` })
    await markRequest(r.id, 'Fulfilled')
  }

  function locationName(id: number): string {
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  if (loading) {
    return (
      <div className="d-flex justify-content-center py-5">
        <div className="spinner-border text-primary" role="status" />
      </div>
    )
  }

  return (
    <div className="container-fluid mt-4">
      <h2 className="mb-4">
        <i className="bi bi-speedometer2" /> 地方物資戰情總覽
      </h2>
      <FlashMessage />

      {/* p.9 色塊改色：四種狀態統一配色（藍/紅/黃/鐵灰），共用 lib/statusColors */}
      <div className="row g-3 mb-4">
        {AllDashboardStatuses.map((key) => {
          const c = statusColorMap[key]
          const count: Record<DashboardStatusKey, number> = {
            locationLowStock: lowStockItemCount,
            globalLowStock: globalLowStockCount,
            expiringSoon: expiringSoonCount,
            expired: expiredCount,
          }
          return (
            <div className="col-md-3" key={key}>
              {/* p.2：色塊本身可點擊，跳到該狀態清單頁 */}
              <Link to={`/status/${key}`} className="card shadow-sm border-0 h-100 text-decoration-none" style={statusCardStyle(key)}>
                <div className="card-body">
                  <h6>
                    <i className={`bi ${c.icon}`} /> {c.label}
                  </h6>
                  <h2 className="mb-0">{count[key]}</h2>
                  <small style={{ opacity: 0.85 }}>點擊查看清單 →</small>
                </div>
              </Link>
            </div>
          )
        })}
      </div>

      <div className="row mb-4">
        <div className="col-12">
          <div className="card shadow-sm">
            <div className="card-header bg-secondary text-white">
              <i className="bi bi-pin-map-fill" /> 各據點物資統計
            </div>
            <div className="card-body">
              {locationSummaries.length === 0 ? (
                <p className="text-muted mb-0">目前沒有據點資料</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-bordered table-hover">
                    <thead className="table-light">
                      <tr>
                        <th>據點名稱</th>
                        <th>狀態</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locationSummaries.map((location) => (
                        <tr key={location.locationId}>
                          <td>
                            <i className="bi bi-building" /> {location.locationName}
                          </td>
                          <td>
                            {/* p.10：狀態欄取代「低庫存項目」數字，有異常才顯示對應狀態，否則顯示正常。 */}
                            {location.lowStockCount === 0 && location.expiringSoonCount === 0 ? (
                              <span className="badge bg-success">正常</span>
                            ) : (
                              <div className="d-flex flex-wrap gap-1">
                                {location.lowStockCount > 0 && (
                                  <span className="badge" style={{ backgroundColor: statusColorMap.locationLowStock.bg, color: statusColorMap.locationLowStock.text }}>
                                    低庫存 {location.lowStockCount}
                                  </span>
                                )}
                                {location.expiringSoonCount > 0 && (
                                  <span className="badge" style={{ backgroundColor: statusColorMap.expiringSoon.bg, color: statusColorMap.expiringSoon.text }}>
                                    即將過期 {location.expiringSoonCount}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td>
                            {/* 物資清單僅總管可開；其他角色只看狀態，不顯示會被擋的按鈕。 */}
                            {isAdmin ? (
                              <Link to={`/supply-items?locationId=${location.locationId}`} className="btn btn-sm btn-primary">
                                <i className="bi bi-search" /> 查看物資
                              </Link>
                            ) : (
                              <span className="text-muted small">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* p.5/6/7：待處理缺料需求（全體可見）；來源據點可一鍵「轉移補貨」 */}
      <div className="row">
        <div className="col-12 mb-4">
          <div className="card shadow-sm">
            <div className="card-header" style={{ backgroundColor: statusColorMap.locationLowStock.bg, color: statusColorMap.locationLowStock.text }}>
              <i className="bi bi-hand-index-thumb" /> 待處理需求（{requests.length}）
            </div>
            <div className="card-body">
              {requests.length === 0 ? (
                <p className="text-muted mb-0">目前沒有待處理的缺料需求</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th className="col-min">提出時間</th>
                        <th>品項</th>
                        <th className="col-min">需求據點</th>
                        <th className="col-min">來源據點</th>
                        <th className="col-min">數量</th>
                        <th className="col-min">提出人</th>
                        <th className="col-min">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map((r) => {
                        const isDisposal = r.request_type === 'disposal'
                        return (
                        <tr key={r.id}>
                          <td className="col-min">{new Date(r.created_at).toLocaleString('zh-TW')}</td>
                          <td>
                            {isDisposal && <span className="badge bg-dark me-1">報廢申請</span>}
                            <strong>{r.item_name}</strong>
                            {r.specification ? <span className="text-muted">／{r.specification}</span> : null}
                            <span className="text-muted">（{r.category}）</span>
                          </td>
                          <td className="col-min">
                            <span className="badge" style={locationColorStyle(r.requesting_location_id)}>
                              {locationName(r.requesting_location_id)}
                            </span>
                          </td>
                          <td className="col-min">
                            {r.source_location_id ? (
                              <span className="badge" style={locationColorStyle(r.source_location_id)}>
                                {locationName(r.source_location_id)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="col-min">{r.quantity}</td>
                          <td className="col-min">{r.requested_by}</td>
                          <td className="col-min">
                            <div className="d-flex gap-1">
                              {isDisposal ? (
                                isAdmin ? (
                                  <>
                                    <button className="btn btn-sm btn-dark" onClick={() => void approveDisposal(r)} title="核准並報廢">
                                      <i className="bi bi-trash3" /> 核准報廢
                                    </button>
                                    <button className="btn btn-sm btn-outline-secondary" onClick={() => void markRequest(r.id, 'Cancelled')}>駁回</button>
                                  </>
                                ) : (
                                  <span className="text-muted small">等待總管核准</span>
                                )
                              ) : (
                                <>
                                  {isAdminOrCadre && (
                                    <Link className="btn btn-sm btn-primary" to={`/transfers/create?requestId=${r.id}`} title="從來源據點轉移補貨">
                                      <i className="bi bi-arrow-left-right" /> 轉移補貨
                                    </Link>
                                  )}
                                  {isAdmin && (
                                    <>
                                      <button className="btn btn-sm btn-outline-success" onClick={() => void markRequest(r.id, 'Fulfilled')}>完成</button>
                                      <button className="btn btn-sm btn-outline-secondary" onClick={() => void markRequest(r.id, 'Cancelled')}>取消</button>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

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
import type { SupplyLocation, SupplyRequest } from '../types/db'

interface LowStockRow {
  location_id?: number
  inventory_item_definition_id: number
  category: string
  item_name: string
  unit: string
  safety_stock?: number
  global_safety_stock?: number
  total_quantity: number
}

interface ExpiringRow {
  id: number
  item_name: string
  category: string
  specification: string | null
  quantity: number
  unit: string | null
  expiration_date: string
  location_id: number
}

interface ResolvedRow {
  location_id: number
  resolved_definition_id: number | null
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
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [locationLowStock, setLocationLowStock] = useState<LowStockRow[]>([])
  const [globalLowStock, setGlobalLowStock] = useState<LowStockRow[]>([])
  const [expiringSoon, setExpiringSoon] = useState<ExpiringRow[]>([])
  const [expiredCount, setExpiredCount] = useState(0)
  const [locationSummaries, setLocationSummaries] = useState<LocationSummary[]>([])
  const [requests, setRequests] = useState<SupplyRequest[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
      setLoading(true)
      const todayStr = new Date().toISOString().slice(0, 10)
      const in30Str = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

      const [locRes, resolvedRes, allItemsRes, locLowRes, globalLowRes, expiringRes, expiredRes, reqRes] = await Promise.all([
        supabase.from('supply_location').select('*').eq('is_active', true).order('id'),
        supabase.from('supply_item_resolved').select('location_id, resolved_definition_id'),
        supabase.from('supply_item').select('location_id, quantity').eq('is_active', true),
        supabase.from('location_low_stock_view').select('*'),
        supabase.from('global_low_stock_view').select('*'),
        supabase
          .from('supply_item')
          .select('id, item_name, category, specification, quantity, unit, expiration_date, location_id')
          .eq('is_active', true)
          .gte('expiration_date', todayStr)
          .lte('expiration_date', in30Str)
          .order('expiration_date'),
        supabase
          .from('supply_item')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true)
          .lt('expiration_date', todayStr),
        supabase.from('supply_request').select('*').eq('status', 'Open').order('created_at', { ascending: false }),
      ])

      const locs = (locRes.data ?? []) as SupplyLocation[]
      const resolved = (resolvedRes.data ?? []) as ResolvedRow[]
      const allItems = (allItemsRes.data ?? []) as { location_id: number; quantity: number }[]
      const locLow = (locLowRes.data ?? []) as LowStockRow[]

      setLocations(locs)
      setLocationLowStock(locLow)
      setGlobalLowStock((globalLowRes.data ?? []) as LowStockRow[])
      setExpiringSoon((expiringRes.data ?? []) as ExpiringRow[])
      setExpiredCount(expiredRes.count ?? 0)
      setRequests((reqRes.data ?? []) as SupplyRequest[])

      setLocationSummaries(
        locs.map((location) => ({
          locationId: location.id,
          locationName: location.location_name,
          itemTypeCount: new Set(
            resolved.filter((r) => r.location_id === location.id && r.resolved_definition_id != null).map((r) => r.resolved_definition_id)
          ).size,
          totalQuantity: allItems.filter((i) => i.location_id === location.id).reduce((sum, i) => sum + i.quantity, 0),
          lowStockCount: locLow.filter((r) => r.location_id === location.id).length,
          expiringSoonCount: (expiringRes.data ?? []).filter((r) => (r as ExpiringRow).location_id === location.id).length,
        }))
      )

      setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  async function markRequest(id: number, status: 'Fulfilled' | 'Cancelled') {
    await supabase.from('supply_request').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    void load()
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
            locationLowStock: locationLowStock.length,
            globalLowStock: globalLowStock.length,
            expiringSoon: expiringSoon.length,
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
                        <th>物資種類數</th>
                        <th>總數量</th>
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
                          <td>{location.itemTypeCount}</td>
                          <td>
                            <strong>{location.totalQuantity}</strong>
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
                            <Link to={`/supply-items?locationId=${location.locationId}`} className="btn btn-sm btn-primary">
                              <i className="bi bi-search" /> 查看物資
                            </Link>
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
            <div className="card-header text-white" style={{ backgroundColor: statusColorMap.locationLowStock.bg }}>
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
                      {requests.map((r) => (
                        <tr key={r.id}>
                          <td className="col-min">{new Date(r.created_at).toLocaleString('zh-TW')}</td>
                          <td>
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
                              <Link className="btn btn-sm btn-primary" to={`/transfers/create?requestId=${r.id}`} title="從來源據點轉移補貨">
                                <i className="bi bi-arrow-left-right" /> 轉移補貨
                              </Link>
                              <button className="btn btn-sm btn-outline-success" onClick={() => void markRequest(r.id, 'Fulfilled')}>
                                完成
                              </button>
                              <button className="btn btn-sm btn-outline-secondary" onClick={() => void markRequest(r.id, 'Cancelled')}>
                                取消
                              </button>
                            </div>
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

    </div>
  )
}

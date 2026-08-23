// Port of DashboardController + DashboardService + Views/Dashboard/Index.cshtml.
// All aggregates read from the shared views (supply_item_resolved,
// location_low_stock_view, global_low_stock_view) instead of duplicating the
// resolution logic here — see migration plan §一.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { locationColorStyle } from '../lib/colors'
import { statusColorMap, statusCardStyle, AllDashboardStatuses, type DashboardStatusKey } from '../lib/statusColors'
import type { SupplyLocation } from '../types/db'

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
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function Dashboard() {
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [locationLowStock, setLocationLowStock] = useState<LowStockRow[]>([])
  const [globalLowStock, setGlobalLowStock] = useState<LowStockRow[]>([])
  const [expiringSoon, setExpiringSoon] = useState<ExpiringRow[]>([])
  const [expiredCount, setExpiredCount] = useState(0)
  const [locationSummaries, setLocationSummaries] = useState<LocationSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const todayStr = new Date().toISOString().slice(0, 10)
      const in30Str = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

      const [locRes, resolvedRes, allItemsRes, locLowRes, globalLowRes, expiringRes, expiredRes] = await Promise.all([
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

      setLocationSummaries(
        locs.map((location) => ({
          locationId: location.id,
          locationName: location.location_name,
          itemTypeCount: new Set(
            resolved.filter((r) => r.location_id === location.id && r.resolved_definition_id != null).map((r) => r.resolved_definition_id)
          ).size,
          totalQuantity: allItems.filter((i) => i.location_id === location.id).reduce((sum, i) => sum + i.quantity, 0),
          lowStockCount: locLow.filter((r) => r.location_id === location.id).length,
        }))
      )

      setLoading(false)
    }
    void load()
  }, [])

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
              <div className="card shadow-sm border-0 h-100" style={statusCardStyle(key)}>
                <div className="card-body">
                  <h6>
                    <i className={`bi ${c.icon}`} /> {c.label}
                  </h6>
                  <h2 className="mb-0">{count[key]}</h2>
                </div>
              </div>
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
                        <th>低庫存項目</th>
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
                            {location.lowStockCount > 0 ? (
                              <span className="badge bg-danger">{location.lowStockCount}</span>
                            ) : (
                              <span className="badge bg-success">正常</span>
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

      <div className="row">
        <div className="col-md-6 mb-4">
          <div className="card shadow-sm">
            <div className="card-header bg-danger text-white">
              <i className="bi bi-exclamation-triangle-fill" /> 低於警戒水位物資
            </div>
            <div className="card-body">
              {locationLowStock.length === 0 ? (
                <p className="text-muted mb-0">沒有低庫存物資</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-bordered table-hover table-sm">
                    <thead>
                      <tr>
                        <th>據點</th>
                        <th>物資</th>
                        <th>目前數量</th>
                        <th>安全庫存</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locationLowStock.slice(0, 10).map((row, i) => (
                        <tr key={i}>
                          <td>
                            <span className="badge" style={locationColorStyle(row.location_id!)}>
                              {locationName(row.location_id!)}
                            </span>
                          </td>
                          <td>
                            <strong>
                              {row.category}／{row.item_name}
                            </strong>
                          </td>
                          <td className="text-danger">
                            <strong>{row.total_quantity}</strong> {row.unit}
                          </td>
                          <td>
                            {row.safety_stock} {row.unit}
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

        <div className="col-md-6 mb-4">
          <div className="card shadow-sm">
            <div className="card-header bg-danger text-white">
              <i className="bi bi-globe" /> 全系統總量不足
            </div>
            <div className="card-body">
              {globalLowStock.length === 0 ? (
                <p className="text-muted mb-0">沒有總量不足的物資</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-bordered table-hover table-sm">
                    <thead>
                      <tr>
                        <th>物資</th>
                        <th>目前數量</th>
                        <th>安全庫存</th>
                      </tr>
                    </thead>
                    <tbody>
                      {globalLowStock.slice(0, 10).map((row, i) => (
                        <tr key={i}>
                          <td>
                            <strong>
                              {row.category}／{row.item_name}
                            </strong>
                          </td>
                          <td className="text-danger">
                            <strong>{row.total_quantity}</strong> {row.unit}
                          </td>
                          <td>
                            {row.global_safety_stock} {row.unit}
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

      <div className="row">
        <div className="col-12 mb-4">
          <div className="card shadow-sm">
            <div className="card-header bg-warning text-dark">
              <i className="bi bi-clock-fill" /> 即將過期物資
            </div>
            <div className="card-body">
              {expiringSoon.length === 0 ? (
                <p className="text-muted mb-0">沒有即將過期的物資</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-bordered table-hover table-sm">
                    <thead>
                      <tr>
                        <th>據點</th>
                        <th>物資</th>
                        <th>規格</th>
                        <th>數量</th>
                        <th>有效期限</th>
                        <th>剩餘天數</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {expiringSoon.slice(0, 10).map((item) => (
                        <tr key={item.id}>
                          <td>
                            <span className="badge" style={locationColorStyle(item.location_id)}>
                              {locationName(item.location_id)}
                            </span>
                          </td>
                          <td>
                            <strong>{item.item_name}</strong>
                          </td>
                          <td>{item.specification ?? '－'}</td>
                          <td>
                            {item.quantity} {item.unit}
                          </td>
                          <td className="text-warning">
                            <strong>{item.expiration_date}</strong>
                          </td>
                          <td>{daysBetween(new Date(), new Date(item.expiration_date))} 天</td>
                          <td>
                            <Link
                              to={`/outbound/create?supplyItemId=${item.id}&locationId=${item.location_id}`}
                              className="btn btn-sm btn-outline-primary"
                            >
                              選擇出庫
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
    </div>
  )
}

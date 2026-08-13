// Port of DashboardController + DashboardService + Views/Dashboard/Index.cshtml.
// All aggregates read from the shared views (supply_item_resolved,
// location_low_stock_view, global_low_stock_view) instead of duplicating the
// resolution logic here — see migration plan §一.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { locationColorStyle } from '../lib/colors'
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

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function Dashboard() {
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [totalQuantity, setTotalQuantity] = useState(0)
  const [itemTypeCount, setItemTypeCount] = useState(0)
  const [locationLowStock, setLocationLowStock] = useState<LowStockRow[]>([])
  const [globalLowStock, setGlobalLowStock] = useState<LowStockRow[]>([])
  const [expiringSoon, setExpiringSoon] = useState<ExpiringRow[]>([])
  const [expiredCount, setExpiredCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const todayStr = new Date().toISOString().slice(0, 10)
      const in30Str = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

      const [locRes, resolvedRes, locLowRes, globalLowRes, expiringRes, expiredRes] = await Promise.all([
        supabase.from('supply_location').select('*').eq('is_active', true).order('id'),
        supabase.from('supply_item_resolved').select('resolved_definition_id, quantity'),
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

      setLocations((locRes.data ?? []) as SupplyLocation[])
      setTotalQuantity((resolvedRes.data ?? []).reduce((sum, r) => sum + (r.quantity ?? 0), 0))
      setItemTypeCount(new Set((resolvedRes.data ?? []).map((r) => r.resolved_definition_id)).size)
      setLocationLowStock((locLowRes.data ?? []) as LowStockRow[])
      setGlobalLowStock((globalLowRes.data ?? []) as LowStockRow[])
      setExpiringSoon((expiringRes.data ?? []) as ExpiringRow[])
      setExpiredCount(expiredRes.count ?? 0)
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
        <i className="bi bi-speedometer2" /> 戰情總覽
      </h2>

      <div className="row g-3 mb-4">
        <div className="col-md-3">
          <div className="card shadow-sm text-center">
            <div className="card-body">
              <i className="bi bi-buildings fs-2 text-primary" />
              <h3 className="mt-2 mb-0">{locations.length}</h3>
              <p className="text-muted mb-0">據點數</p>
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card shadow-sm text-center">
            <div className="card-body">
              <i className="bi bi-tags fs-2 text-success" />
              <h3 className="mt-2 mb-0">{itemTypeCount}</h3>
              <p className="text-muted mb-0">物資種類數</p>
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card shadow-sm text-center">
            <div className="card-body">
              <i className="bi bi-box-seam fs-2 text-info" />
              <h3 className="mt-2 mb-0">{totalQuantity}</h3>
              <p className="text-muted mb-0">總庫存量</p>
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card shadow-sm text-center">
            <div className="card-body">
              <i className="bi bi-exclamation-triangle fs-2 text-danger" />
              <h3 className="mt-2 mb-0">{locationLowStock.length + globalLowStock.length}</h3>
              <p className="text-muted mb-0">低庫存警示</p>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-md-6">
          <div className="card shadow-sm h-100">
            <div className="card-header bg-light">
              <i className="bi bi-building-exclamation" /> 據點安全庫存警示（共 {locationLowStock.length} 項）
            </div>
            <div className="card-body">
              {locationLowStock.length === 0 ? (
                <p className="text-success mb-0">
                  <i className="bi bi-check-circle" /> 各據點庫存皆高於門檻
                </p>
              ) : (
                <table className="table table-sm mb-0">
                  <thead>
                    <tr>
                      <th>據點</th>
                      <th>物資</th>
                      <th>現有／門檻</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locationLowStock.map((row, i) => (
                      <tr key={i}>
                        <td>
                          <span className="badge" style={locationColorStyle(row.location_id!)}>
                            {locationName(row.location_id!)}
                          </span>
                        </td>
                        <td>
                          {row.category}｜{row.item_name}
                        </td>
                        <td className="text-danger">
                          {row.total_quantity} / {row.safety_stock} {row.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="col-md-6">
          <div className="card shadow-sm h-100">
            <div className="card-header bg-light">
              <i className="bi bi-globe" /> 全系統安全庫存警示（共 {globalLowStock.length} 項）
            </div>
            <div className="card-body">
              {globalLowStock.length === 0 ? (
                <p className="text-success mb-0">
                  <i className="bi bi-check-circle" /> 全系統庫存皆高於門檻
                </p>
              ) : (
                <table className="table table-sm mb-0">
                  <thead>
                    <tr>
                      <th>物資</th>
                      <th>現有／門檻</th>
                    </tr>
                  </thead>
                  <tbody>
                    {globalLowStock.map((row, i) => (
                      <tr key={i}>
                        <td>
                          {row.category}｜{row.item_name}
                        </td>
                        <td className="text-danger">
                          {row.total_quantity} / {row.global_safety_stock} {row.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="col-12">
          <div className="card shadow-sm">
            <div className="card-header bg-light">
              <i className="bi bi-exclamation-triangle-fill" /> 即期／已過期物資（30 天內共 {expiringSoon.length} 項，已過期 {expiredCount} 項）
            </div>
            <div className="card-body">
              {expiringSoon.length === 0 ? (
                <p className="text-success mb-0">
                  <i className="bi bi-check-circle" /> 無 30 天內到期品項
                </p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm mb-0">
                    <thead>
                      <tr>
                        <th>物資</th>
                        <th>據點</th>
                        <th>庫存</th>
                        <th>有效期限</th>
                        <th>剩餘天數</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {expiringSoon.map((item) => (
                        <tr key={item.id}>
                          <td>
                            {item.category}｜{item.item_name}
                            {item.specification ? `｜${item.specification}` : ''}
                          </td>
                          <td>
                            <span className="badge" style={locationColorStyle(item.location_id)}>
                              {locationName(item.location_id)}
                            </span>
                          </td>
                          <td>
                            {item.quantity} {item.unit}
                          </td>
                          <td>{item.expiration_date}</td>
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

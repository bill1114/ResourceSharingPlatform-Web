// Port of MapController + Views/Map/Index.cshtml. Leaflet 1.9.4 + OpenStreetMap
// tiles via react-leaflet, same center/zoom/marker-coloring rules as the .NET
// version — see migration plan §七/§一.
import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { SupplyLocation } from '../types/db'

interface LocationStats {
  itemTypeCount: number
  totalQuantity: number
  lowStockCount: number
  expiringSoonCount: number
}

const YUNLIN_CENTER: [number, number] = [23.7078, 120.5439]

function markerColor(stats: LocationStats): string {
  if (stats.lowStockCount > 0) return '#dc3545' // red
  if (stats.expiringSoonCount > 0) return '#fd7e14' // orange
  return '#0d6efd' // blue
}

export function SupplyMap() {
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [statsByLocation, setStatsByLocation] = useState<Record<number, LocationStats>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const todayStr = new Date().toISOString().slice(0, 10)
      const in30Str = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

      const [locRes, resolvedRes, lowStockRes, expiringRes] = await Promise.all([
        supabase
          .from('supply_location')
          .select('*')
          .eq('is_active', true)
          .not('latitude', 'is', null)
          .not('longitude', 'is', null),
        supabase.from('supply_item_resolved').select('location_id, resolved_definition_id, quantity'),
        supabase.from('location_low_stock_view').select('location_id'),
        supabase
          .from('supply_item')
          .select('location_id')
          .eq('is_active', true)
          .gte('expiration_date', todayStr)
          .lte('expiration_date', in30Str),
      ])

      const locs = (locRes.data ?? []) as SupplyLocation[]
      setLocations(locs)

      const stats: Record<number, LocationStats> = {}
      for (const loc of locs) {
        const itemsHere = (resolvedRes.data ?? []).filter((r) => r.location_id === loc.id)
        stats[loc.id] = {
          itemTypeCount: new Set(itemsHere.map((r) => r.resolved_definition_id)).size,
          totalQuantity: itemsHere.reduce((sum, r) => sum + (r.quantity ?? 0), 0),
          lowStockCount: (lowStockRes.data ?? []).filter((r) => r.location_id === loc.id).length,
          expiringSoonCount: (expiringRes.data ?? []).filter((r) => r.location_id === loc.id).length,
        }
      }
      setStatsByLocation(stats)
      setLoading(false)
    }
    void load()
  }, [])

  return (
    <div className="container-fluid mt-4">
      <h2 className="mb-4">
        <i className="bi bi-geo-alt" /> 據點地圖
      </h2>
      {loading ? (
        <div className="d-flex justify-content-center py-5">
          <div className="spinner-border text-primary" role="status" />
        </div>
      ) : (
        <div style={{ height: '70vh', borderRadius: 8, overflow: 'hidden' }}>
          <MapContainer center={YUNLIN_CENTER} zoom={11} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {locations.map((loc) => {
              const stats = statsByLocation[loc.id]
              if (!stats || loc.latitude == null || loc.longitude == null) return null
              return (
                <CircleMarker
                  key={loc.id}
                  center={[loc.latitude, loc.longitude]}
                  radius={12}
                  pathOptions={{ color: markerColor(stats), fillColor: markerColor(stats), fillOpacity: 0.8 }}
                >
                  <Popup>
                    <strong>{loc.location_name}</strong>
                    <br />
                    物資種類：{stats.itemTypeCount}　總量：{stats.totalQuantity}
                    <br />
                    {stats.lowStockCount > 0 && <span className="text-danger">低庫存：{stats.lowStockCount} 項　</span>}
                    {stats.expiringSoonCount > 0 && <span className="text-warning">即期：{stats.expiringSoonCount} 項</span>}
                    <br />
                    <Link to={`/supply-items?locationId=${loc.id}`}>查看物資 →</Link>
                  </Popup>
                </CircleMarker>
              )
            })}
          </MapContainer>
        </div>
      )}
    </div>
  )
}

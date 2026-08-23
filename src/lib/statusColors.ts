// 戰情總覽四種狀態的統一配色（分工單 p.9「色塊改色」）。
// 抽成單一來源，Dashboard 的色塊、篩選元件（p.3）與共用狀態版面（p.4）都引用這裡，
// 之後要改色只改一處。
//   藍   據點低庫存 (locationLowStock)
//   紅   總量不足   (globalLowStock)
//   黃   即將過期   (expiringSoon)
//   鐵灰 已過期     (expired)
import type { CSSProperties } from 'react'

export type DashboardStatusKey = 'locationLowStock' | 'globalLowStock' | 'expiringSoon' | 'expired'

export interface StatusColor {
  label: string
  bg: string // 背景色
  text: string // 對比文字色
  icon: string // bootstrap-icons class
}

export const statusColorMap: Record<DashboardStatusKey, StatusColor> = {
  locationLowStock: { label: '據點低庫存', bg: '#0d6efd', text: '#ffffff', icon: 'bi-exclamation-triangle-fill' }, // 藍
  globalLowStock: { label: '總量不足', bg: '#dc3545', text: '#ffffff', icon: 'bi-globe' }, // 紅
  expiringSoon: { label: '即將過期', bg: '#ffc107', text: '#212529', icon: 'bi-clock-fill' }, // 黃
  expired: { label: '已過期', bg: '#495057', text: '#ffffff', icon: 'bi-x-circle-fill' }, // 鐵灰
}

export const AllDashboardStatuses: DashboardStatusKey[] = ['locationLowStock', 'globalLowStock', 'expiringSoon', 'expired']

// 供「色塊」用的內嵌樣式（背景＋文字色）。
export function statusCardStyle(key: DashboardStatusKey): CSSProperties {
  const c = statusColorMap[key]
  return { backgroundColor: c.bg, color: c.text }
}

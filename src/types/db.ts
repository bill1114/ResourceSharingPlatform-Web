// Hand-written types for the tables the app touches early on. Expand as more
// screens are built; consider swapping to `supabase gen types typescript` once
// the schema stabilizes.

import type { Role } from '../lib/enums'

export interface Profile {
  id: string
  username: string
  display_name: string | null
  role_name: Role
  location_id: number | null
  is_active: boolean
  created_at: string
  updated_at: string | null
}

export interface SupplyLocation {
  id: number
  location_name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  contact_person: string | null
  phone: string | null
  is_active: boolean
  created_at: string
  updated_at: string | null
}

export interface InventoryItemDefinition {
  id: number
  category: string
  item_name: string
  unit: string
  global_safety_stock: number
  stock_type: string
  is_active: boolean
  created_at: string
  updated_at: string | null
}

export interface InventoryItemVariant {
  id: number
  inventory_item_definition_id: number
  specification: string | null
  is_active: boolean
  created_at: string
  updated_at: string | null
}

export interface LocationInventorySafetyStock {
  id: number
  location_id: number
  inventory_item_definition_id: number
  safety_stock: number
  created_at: string
  updated_at: string | null
}

export interface SupplyOutboundLog {
  id: number
  supply_item_id: number
  location_id: number
  outbound_quantity: number
  recipient_name: string
  recipient_contact: string | null
  operator: string | null
  outbound_time: string
  remark: string | null
}

export interface SupplyDonationLog {
  id: number
  supply_item_id: number
  location_id: number
  donation_quantity: number
  donor_name: string
  donor_contact: string | null
  operator: string | null
  donation_time: string
  remark: string | null
}

export interface SupplyDisposalLog {
  id: number
  supply_item_id: number
  location_id: number
  disposal_quantity: number
  reason: string
  operator: string | null
  disposal_time: string
  remark: string | null
}

export interface SupplyItem {
  id: number
  category: string
  item_name: string
  specification: string | null
  quantity: number
  unit: string | null
  stock_type: string
  expiration_date: string | null
  image_path: string | null
  inventory_item_variant_id: number | null
  location_id: number
  safety_stock: number
  remark: string | null
  is_active: boolean
  created_at: string
  updated_at: string | null
}

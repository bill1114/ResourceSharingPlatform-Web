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

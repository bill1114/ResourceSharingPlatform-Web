// Replaces [Authorize(Roles = "...")] — wrap any element/route content that should
// only render for specific roles.
import type { ReactNode } from 'react'
import { useAuth } from '../hooks/useAuth'
import type { Role } from '../lib/enums'

export function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { profile } = useAuth()
  if (!profile || !roles.includes(profile.role_name)) {
    return null
  }
  return <>{children}</>
}

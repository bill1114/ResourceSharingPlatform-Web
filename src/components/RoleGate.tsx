// Replaces [Authorize(Roles = "...")] — wrap any element/route content that should
// only render for specific roles. When the role isn't allowed it renders `fallback`
// (nothing by default). The LINE mobile routes pass a friendly fallback so a
// non-permitted user tapping a rich-menu button sees a message, not a blank page.
import type { ReactNode } from 'react'
import { useAuth } from '../hooks/useAuth'
import type { Role } from '../lib/enums'

export function RoleGate({ roles, children, fallback = null }: { roles: Role[]; children: ReactNode; fallback?: ReactNode }) {
  const { profile } = useAuth()
  if (!profile || !roles.includes(profile.role_name)) {
    return <>{fallback}</>
  }
  return <>{children}</>
}

import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useEngineeringMode } from '../hooks/useEngineeringMode'

export function EngineeringRoute({ children }: { children: ReactNode }) {
  const { enabled } = useEngineeringMode()
  return enabled ? <>{children}</> : <Navigate to="/" replace />
}

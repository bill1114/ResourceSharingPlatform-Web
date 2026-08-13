import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'rsp-engineering-mode'

interface EngineeringModeValue {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

const EngineeringModeContext = createContext<EngineeringModeValue | undefined>(undefined)

export function EngineeringModeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(() => localStorage.getItem(STORAGE_KEY) === 'enabled')

  function setEnabled(next: boolean) {
    setEnabledState(next)
    if (next) localStorage.setItem(STORAGE_KEY, 'enabled')
    else localStorage.removeItem(STORAGE_KEY)
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        setEnabled(!enabled)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled])

  return <EngineeringModeContext.Provider value={{ enabled, setEnabled }}>{children}</EngineeringModeContext.Provider>
}

export function useEngineeringMode() {
  const value = useContext(EngineeringModeContext)
  if (!value) throw new Error('useEngineeringMode must be used within EngineeringModeProvider')
  return value
}

// After a create/confirm action we navigate back to the matching list/總覽 and
// pass a one-off success message via router state ({ flash }). This reads it,
// shows a dismissible success alert, then clears the history state so a refresh
// or back-navigation doesn't replay it. Fixes the "form just sits there after
// submit" confusion — every create screen now lands you on its 紀錄/清單 with a
// clear ✓ message.
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

export function FlashMessage() {
  const location = useLocation()
  const incoming = (location.state as { flash?: string } | null)?.flash ?? null
  const [msg, setMsg] = useState<string | null>(incoming)

  useEffect(() => {
    if (!incoming) return
    setMsg(incoming)
    // Drop the flash from history state so refresh/back doesn't show it again.
    window.history.replaceState({}, '')
    const t = setTimeout(() => setMsg(null), 6000)
    return () => clearTimeout(t)
  }, [incoming])

  if (!msg) return null
  return (
    <div className="alert alert-success alert-dismissible d-flex align-items-center" role="alert">
      <i className="bi bi-check-circle-fill me-2" />
      <div className="flex-grow-1">{msg}</div>
      <button type="button" className="btn-close" aria-label="關閉" onClick={() => setMsg(null)} />
    </div>
  )
}

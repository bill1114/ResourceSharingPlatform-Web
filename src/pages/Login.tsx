import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabaseClient'

export function Login() {
  const { session, signIn } = useAuth()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // 忘記密碼
  const [showForgot, setShowForgot] = useState(false)
  const [forgotName, setForgotName] = useState('')
  const [forgotNote, setForgotNote] = useState('')
  const [forgotMsg, setForgotMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [forgotBusy, setForgotBusy] = useState(false)

  async function submitForgot(e: FormEvent) {
    e.preventDefault()
    if (!forgotName.trim()) return
    setForgotBusy(true)
    setForgotMsg(null)
    const { error } = await supabase.from('password_reset_request').insert({ username: forgotName.trim(), note: forgotNote.trim() || null })
    setForgotBusy(false)
    if (error) { setForgotMsg({ ok: false, text: '送出失敗，請稍後再試或直接聯絡管理員。' }); return }
    setForgotMsg({ ok: true, text: '已通知管理員（總管），請等候協助重設密碼。' })
    setForgotName(''); setForgotNote('')
  }

  // 登入後一律導向戰情總覽（/）；唯一例外是 LINE 圖文選單的 /mobile/* 深連結，
  // 保留使用者原本點的手機功能頁，其餘全部統一回戰情總覽。
  const requested = (location.state as { from?: string })?.from
  const target = requested && requested.startsWith('/mobile/') ? requested : '/'

  if (session) {
    return <Navigate to={target} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await signIn(username, password)
    setSubmitting(false)
    if (error) {
      setError(error)
    }
    // On success `session` becomes truthy and the guard above redirects to `from`.
  }

  return (
    <div className="container d-flex justify-content-center align-items-center" style={{ minHeight: '80vh' }}>
      <div className="card shadow-sm" style={{ width: '100%', maxWidth: 400 }}>
        <div className="card-body p-4">
          <h2 className="text-center mb-4">
            <i className="bi bi-box-seam" /> 愛心轉運站
          </h2>
          {error && (
            <div className="alert alert-danger py-2" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label">帳號</label>
              <input
                className="form-control"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="mb-3">
              <label className="form-label">密碼</label>
              <input
                type="password"
                className="form-control"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
              {submitting ? '登入中…' : '登入'}
            </button>
          </form>

          <div className="text-center mt-3">
            <button type="button" className="btn btn-link btn-sm text-decoration-none" onClick={() => { setShowForgot((v) => !v); setForgotMsg(null) }}>
              忘記密碼？
            </button>
          </div>

          {showForgot && (
            <div className="border rounded p-3 mt-2 bg-light">
              <div className="small text-muted mb-2">送出後由管理員（總管）確認並協助重設密碼，系統不會自動改密碼。</div>
              {forgotMsg && <div className={`alert alert-${forgotMsg.ok ? 'success' : 'danger'} py-2`}>{forgotMsg.text}</div>}
              <form onSubmit={submitForgot}>
                <div className="mb-2">
                  <label className="form-label">你的帳號 *</label>
                  <input className="form-control form-control-sm" required value={forgotName} onChange={(e) => setForgotName(e.target.value)} />
                </div>
                <div className="mb-2">
                  <label className="form-label">說明（選填）</label>
                  <input className="form-control form-control-sm" placeholder="例如：忘記密碼、需要重設" value={forgotNote} onChange={(e) => setForgotNote(e.target.value)} />
                </div>
                <button type="submit" className="btn btn-outline-primary btn-sm w-100" disabled={forgotBusy}>
                  {forgotBusy ? '送出中…' : '送出忘記密碼申請'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

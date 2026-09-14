import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function Login() {
  const { session, signIn } = useAuth()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
        </div>
      </div>
    </div>
  )
}

// AI 模型管理 —— 以 iframe 嵌入外部辨識服務的工作台（/workbench），
// 並用 postMessage 把目前登入的 Supabase 存取權杖傳進去（工作台據此呼叫其 API）。
//
// 契約：工作台監聽 { type:'vision-auth', token } 訊息，且來源需為其設定的
// VISION_PARENT_ORIGINS（= APP_ORIGIN，本站網址）。登出時傳空字串 token。
// 未設定 VITE_RECOGNITION_API_URL 時顯示提示。
import { useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { RECOGNITION_API_URL, recognitionEnabled } from '../lib/recognitionApi'

export function AIModels() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const visionOrigin = recognitionEnabled() ? new URL(RECOGNITION_API_URL).origin : ''

  // 把目前的存取權杖傳進工作台（沒有 session 就傳空字串，工作台會提示重新登入）。
  const sendAuth = useCallback(async () => {
    const win = iframeRef.current?.contentWindow
    if (!win || !visionOrigin) return
    const { data } = await supabase.auth.getSession()
    win.postMessage({ type: 'vision-auth', token: data.session?.access_token ?? '' }, visionOrigin)
  }, [visionOrigin])

  useEffect(() => {
    if (!recognitionEnabled()) return
    // 登入狀態變動（含權杖刷新）時重新傳入，維持工作台授權有效。
    const { data: sub } = supabase.auth.onAuthStateChange(() => { void sendAuth() })
    return () => sub.subscription.unsubscribe()
  }, [sendAuth])

  if (!recognitionEnabled()) {
    return (
      <div className="container-fluid mt-4">
        <h2 className="mb-3"><i className="bi bi-robot" /> AI 模型管理</h2>
        <div className="alert alert-warning">
          <i className="bi bi-exclamation-triangle" /> 尚未設定辨識服務網址（<code>VITE_RECOGNITION_API_URL</code>）。
          請先依 <strong>docs/AI辨識服務部署.md</strong> 部署辨識服務，並在 GitHub 專案
          Settings → Secrets and variables → Actions → Variables 新增 <code>VITE_RECOGNITION_API_URL</code> 後重新部署。
          未設定時，AI 智慧入庫維持原本行為。
        </div>
      </div>
    )
  }

  return (
    <div className="container-fluid mt-3" style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="mb-0"><i className="bi bi-robot" /> AI 模型管理</h2>
        <a className="btn btn-sm btn-outline-secondary" href={`${RECOGNITION_API_URL}/workbench`} target="_blank" rel="noreferrer">
          <i className="bi bi-box-arrow-up-right" /> 另開新視窗
        </a>
      </div>
      <iframe
        ref={iframeRef}
        title="AI 模型管理工作台"
        src={`${RECOGNITION_API_URL}/workbench`}
        onLoad={() => void sendAuth()}
        style={{ flex: 1, width: '100%', border: '1px solid #dee2e6', borderRadius: 6 }}
      />
    </div>
  )
}

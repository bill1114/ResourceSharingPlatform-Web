// 外部 AI 辨識服務（YOLO）整合用戶端。
//
// 服務部署在另一台電腦的 Docker 容器，透過反向代理以 HTTPS 對外（見
// docs/AI辨識服務部署.md）。網站只在建置時帶入 VITE_RECOGNITION_API_URL 才會啟用；
// 未設定時，AI 智慧入庫維持原本呼叫 Supabase Edge Function ai-stockin-recognize 的行為。
//
// 契約（modules/vision contracts/openapi.json）：
//   POST {BASE}/api/v1/recognize   權限 operate（總管/幫主）
//     header Authorization: Bearer <supabase access_token>
//     body   { locationId:int, imagePath:string }
//     回傳   { success, logs:[ai_stock_in_log...], message, feedback:{id,image,boxes,...} }
//   POST {BASE}/api/v1/feedback    權限 operate
//     body   { id, boxes, reviewed, negative, note }
import { supabase } from './supabaseClient'

// 去掉結尾斜線；未設定則為空字串（代表未啟用）。
export const RECOGNITION_API_URL = ((import.meta.env.VITE_RECOGNITION_API_URL as string | undefined) ?? '').replace(/\/+$/, '')

export function recognitionEnabled(): boolean {
  return RECOGNITION_API_URL.length > 0
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('登入已失效，請重新登入')
  return token
}

async function callVision<T>(path: string, body: unknown): Promise<T> {
  const token = await accessToken()
  let res: Response
  try {
    res = await fetch(`${RECOGNITION_API_URL}/api/v1${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('無法連線 AI 辨識服務，請確認服務是否啟動或網址設定')
  }
  let data: { success?: boolean; error?: string; message?: string } & Record<string, unknown>
  try {
    data = await res.json()
  } catch {
    throw new Error('AI 辨識服務回覆格式異常，請檢查 API 位址')
  }
  if (!res.ok || data.success === false) {
    throw new Error(data.error || data.message || '辨識服務處理失敗')
  }
  return data as T
}

/** 辨識結果裡附帶的回饋資料（供「框選並提交正確答案」用）。 */
export interface VisionFeedback {
  id: string
  image: string // data:image/png;base64,...
  boxes: { itemId: string | null; label: string; bbox: [number, number, number, number]; confidence: number }[]
  provider?: string
  warnings?: string[]
  reasons?: string[]
}

export interface VisionRecognizeResult {
  success: boolean
  logs: unknown[] // ai_stock_in_log 列，與 ai-stockin-recognize 相同格式
  message: string
  requires_review?: boolean
  feedback?: VisionFeedback
}

/** 正式辨識：由辨識服務跑 YOLO，並寫入 ai_stock_in_log（待確認）。 */
export function recognizeViaVision(params: { locationId: number; imagePath: string }): Promise<VisionRecognizeResult> {
  return callVision<VisionRecognizeResult>('/recognize', { locationId: params.locationId, imagePath: params.imagePath })
}

/** 提交辨識回饋（修正框選），待管理員審核後納入訓練。 */
export function submitVisionFeedback(params: {
  id: string
  boxes: { label: string; bbox: [number, number, number, number] }[]
  reviewed?: boolean
  negative?: boolean
  note?: string
}): Promise<{ success: boolean; message?: string }> {
  return callVision('/feedback', params)
}

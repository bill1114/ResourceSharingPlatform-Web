// 物資領用（發放）— 改為「以領用人為主體的批次領用」：
//   步驟一 領用人資料（姓名／聯絡方式／所屬鄉鎮／身分別）
//   步驟二 發放據點（非管理人員鎖定自己的據點）
//   步驟三 領用清單（可重複開彈窗加入多項物資，各自輸入數量）
// 送出時整批走 outbound-create Edge Function → outbound_create_batch()，
// 全部物資在同一個資料庫交易裡扣庫存，其中一項不足就整批 rollback。
// Index 只是一個受 RLS 限縮的 SELECT。
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { useItemPicker } from '../hooks/useItemPicker'
import { functionErrorMessage } from '../lib/functionError'
import { locationColorStyle } from '../lib/colors'
import { Roles } from '../lib/enums'
import {
  AllRecipientIdentities,
  recipientIdentityBadgeClass,
  recipientIdentityDisplayName,
} from '../lib/yunlinDistricts'
import { ExpiringItemsPanel } from '../components/StockBatchPicker'
import {
  DistrictPickerModal,
  OutboundCancelModal,
  OutboundConfirmModal,
  OutboundItemPickerModal,
} from '../components/OutboundModals'
import { fetchExpiringItems, expiryAlert } from '../lib/stockBatch'
import { FlashMessage } from '../components/FlashMessage'
import { exportToExcel } from '../lib/excelExport'
import type { SupplyItem, SupplyLocation, SupplyOutboundLog } from '../types/db'

/** 批次清單的一列：一個庫存批次 + 這次要領的數量。 */
interface OutboundLine {
  item: SupplyItem
  quantity: number
}

export function SupplyOutboundCreate() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [locations, setLocations] = useState<SupplyLocation[]>([])
  // 非管理人員永遠鎖在自己的據點：初始值、網址參數、快選都不得改變它，
  // 所以 locationId 只在 isAdmin 時才真的當成可變狀態使用（見 effectiveLocationId）。
  const [adminLocationId, setAdminLocationId] = useState<number | null>(profile?.location_id ?? null)
  const effectiveLocationId = isAdmin ? adminLocationId : profile?.location_id ?? null

  const [expiringItems, setExpiringItems] = useState<SupplyItem[]>([])
  const [pendingItemId, setPendingItemId] = useState<number | null>(null)

  // 領用人資料
  const [recipientName, setRecipientName] = useState('')
  const [recipientContact, setRecipientContact] = useState('')
  const [recipientPrecinct, setRecipientPrecinct] = useState<string | null>(null)
  const [recipientDistrict, setRecipientDistrict] = useState<string | null>(null)
  const [recipientIdentity, setRecipientIdentity] = useState('')

  // 批次清單與彈窗
  const [lines, setLines] = useState<OutboundLine[]>([])
  const [showDistrictModal, setShowDistrictModal] = useState(false)
  const [showItemModal, setShowItemModal] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)

  const [remark, setRemark] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 只借用 useItemPicker 的「該據點 + 有庫存」清單，三層連動下拉在批次模式已用不到
  // （改由 OutboundItemPickerModal 自己的搜尋／篩選取代）。
  const picker = useItemPicker(effectiveLocationId)
  const { items: pickerItems, loading: pickerLoading } = picker

  const operatorName = profile?.display_name ?? profile?.username ?? ''
  const expiryScope = useMemo(() => (isAdmin ? null : profile?.location_id ?? null), [isAdmin, profile?.location_id])

  useEffect(() => {
    supabase
      .from('supply_location')
      .select('*')
      .eq('is_active', true)
      .order('id')
      .then(({ data }) => setLocations((data ?? []) as SupplyLocation[]))
  }, [])

  useEffect(() => {
    void fetchExpiringItems(expiryScope).then(setExpiringItems)
  }, [expiryScope])

  // 同一個批次已經加進清單的數量要從可領數量扣掉，不然使用者會加出「兩列合計
  // 超過庫存」的清單，錯誤要等送出才被資料庫擋下來。
  const remainingOf = useCallback(
    (item: SupplyItem) => item.quantity - (lines.find((l) => l.item.id === item.id)?.quantity ?? 0),
    [lines]
  )

  // 加入清單：同一個批次重複加就累加數量，不另開一列。
  const addLine = useCallback((item: SupplyItem, quantity: number) => {
    setError(null)
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.item.id === item.id)
      if (idx < 0) return [...prev, { item, quantity }]
      const next = [...prev]
      next[idx] = { item, quantity: next[idx].quantity + quantity }
      return next
    })
    setShowItemModal(false)
  }, [])

  function updateLineQuantity(itemId: number, value: string) {
    const qty = Number(value)
    setLines((prev) => prev.map((l) => (l.item.id === itemId ? { ...l, quantity: qty } : l)))
  }

  function removeLine(itemId: number) {
    setLines((prev) => prev.filter((l) => l.item.id !== itemId))
  }

  // 戰情總覽的「選擇領用」帶 ?supplyItemId=&locationId= 進來。
  // locationId 只有管理人員採用；其他角色一律以自己的據點為準（RLS 也擋得住，
  // 但先在 UI 擋掉才不會出現空白選單這種看不懂的畫面）。
  useEffect(() => {
    const qLocationId = searchParams.get('locationId')
    const qItemId = searchParams.get('supplyItemId')
    if (isAdmin && qLocationId) setAdminLocationId(Number(qLocationId))
    if (qItemId) setPendingItemId(Number(qItemId))
  }, [searchParams, isAdmin])

  // 快選要等該據點的物資載入完成才挑得到批次，所以先記在 pendingItemId，
  // 載好之後再加進清單（預設數量 1）。
  useEffect(() => {
    if (pendingItemId == null) return
    const target = pickerItems.find((x) => x.id === pendingItemId)
    if (!target) return
    addLine(target, 1)
    setPendingItemId(null)
  }, [pendingItemId, pickerItems, addLine])

  function quickPick(item: SupplyItem) {
    setError(null)
    setNotice(null)
    if (item.location_id !== effectiveLocationId) {
      if (!isAdmin) {
        setError('這項物資不在您所屬的據點')
        return
      }
      if (lines.length > 0) {
        setError('一次領用只能發放同一個據點的物資；請先清空領用清單再切換據點')
        return
      }
      setAdminLocationId(item.location_id)
    }
    setPendingItemId(item.id)
  }

  // 切換據點會讓清單裡的批次全部失效（批次是綁在據點上的），直接清空。
  function changeLocation(id: number | null) {
    setAdminLocationId(id)
    setError(null)
    if (lines.length > 0) {
      setLines([])
      setNotice('已切換據點，原本的領用清單已清空')
    }
  }

  const totalQuantity = lines.reduce((sum, l) => sum + (Number.isFinite(l.quantity) ? l.quantity : 0), 0)

  // 送出前的檢查抽出來，因為現在有兩個時機要用到：按「確認領用」開確認視窗前，
  // 以及確認視窗按下「確定領用」時（視窗開著的期間清單其實動不了，但多一道
  // 保險比較不會在之後改版時漏掉）。回傳 null 代表通過。
  function validate(): string | null {
    if (!effectiveLocationId) return isAdmin ? '請選擇發放據點' : '您的帳號尚未指定所屬據點，無法領用'
    if (!recipientName.trim()) return '請輸入領用人姓名'
    if (!recipientDistrict) return '請選擇領用人所屬鄉鎮'
    if (!recipientIdentity) return '請選擇領用人身分別'
    if (lines.length === 0) return '請至少加入一項要派送的物資'
    for (const l of lines) {
      if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
        return `「${l.item.item_name}」的數量必須是大於 0 的整數`
      }
      if (l.quantity > l.item.quantity) {
        return `「${l.item.item_name}」超過現有庫存（現有 ${l.item.quantity} ${l.item.unit ?? ''}）`
      }
    }
    return null
  }

  // 表單送出不再直接寫資料，先開確認視窗把整張領用單攤出來。
  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setShowConfirmModal(true)
  }

  // 確認視窗按下「確定領用」才真的呼叫 Edge Function。
  async function doSubmit() {
    const problem = validate()
    if (problem) {
      setShowConfirmModal(false)
      setError(problem)
      return
    }

    setSubmitting(true)
    const { data, error: invokeError } = await supabase.functions.invoke('outbound-create', {
      body: {
        locationId: effectiveLocationId,
        items: lines.map((l) => ({ supplyItemId: l.item.id, quantity: l.quantity })),
        recipientName,
        recipientContact,
        recipientPrecinct,
        recipientDistrict,
        recipientIdentity,
        remark,
      },
    })
    setSubmitting(false)

    // 失敗時要拿 Edge Function 自己的中文訊息：supabase-js 會把非 2xx 的內容
    // 換成 "non-2xx status code"，真正的原因藏在 response body 裡。
    // 失敗要把確認視窗關掉，否則錯誤訊息會被蓋在視窗後面看不到。
    if (invokeError || !data?.success) {
      setShowConfirmModal(false)
      setError(data?.message ?? (await functionErrorMessage(invokeError, '領用失敗')))
      return
    }
    navigate('/outbound', { state: { flash: data.message } })
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="mb-0">
          <i className="bi bi-box-arrow-up" /> 物資領用（發放）
        </h2>
        <Link className="btn btn-outline-secondary" to="/outbound">
          <i className="bi bi-list-ul" /> 領用紀錄
        </Link>
      </div>
      <hr />

      <ExpiringItemsPanel
        items={expiringItems}
        locations={locations}
        title="即期／已過期物資，建議優先領用"
        actionLabel="加入清單"
        onPick={quickPick}
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}

      <div className="row g-4">
        <div className="col-lg-8">
          <form onSubmit={handleSubmit}>
            {/* ---------- 步驟一：領用人資料 ---------- */}
            <div className="card shadow-sm mb-4">
              <div className="card-header bg-light">
                <i className="bi bi-person-vcard" /> 步驟一：領用人資料
              </div>
              <div className="card-body">
                <div className="row">
                  <div className="col-md-6 mb-3">
                    <label className="form-label">使用人名稱 *</label>
                    <input
                      className="form-control"
                      required
                      maxLength={50}
                      placeholder="例如：陳先生"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                    />
                  </div>
                  <div className="col-md-6 mb-3">
                    <label className="form-label">使用人聯絡方式</label>
                    <input
                      className="form-control"
                      maxLength={50}
                      placeholder="例如：手機或地址"
                      value={recipientContact}
                      onChange={(e) => setRecipientContact(e.target.value)}
                    />
                  </div>
                </div>

                <div className="row">
                  <div className="col-md-6 mb-3">
                    <label className="form-label">所屬鄉鎮 *</label>
                    <div className="input-group">
                      <input
                        className="form-control"
                        readOnly
                        placeholder="請點右側按鈕選擇"
                        value={recipientDistrict ? `${recipientPrecinct ?? ''}／${recipientDistrict}` : ''}
                      />
                      <button
                        type="button"
                        className="btn btn-outline-primary"
                        onClick={() => setShowDistrictModal(true)}
                      >
                        <i className="bi bi-geo-alt" /> 選擇
                      </button>
                      {recipientDistrict && (
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          title="清除"
                          onClick={() => {
                            setRecipientPrecinct(null)
                            setRecipientDistrict(null)
                          }}
                        >
                          <i className="bi bi-x-lg" />
                        </button>
                      )}
                    </div>
                    <div className="form-text">直接點選鄉鎮市（依分區列出，雲林縣）。</div>
                  </div>
                  <div className="col-md-6 mb-3">
                    <label className="form-label d-block">身分別 *</label>
                    <div className="btn-group flex-wrap" role="group">
                      {AllRecipientIdentities.map((idv) => (
                        <button
                          key={idv}
                          type="button"
                          className={`btn ${recipientIdentity === idv ? 'btn-dark' : 'btn-outline-secondary'}`}
                          onClick={() => setRecipientIdentity(idv)}
                        >
                          {recipientIdentityDisplayName(idv)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ---------- 步驟二：發放據點 ---------- */}
            <div className="card shadow-sm mb-4">
              <div className="card-header bg-light">
                <i className="bi bi-geo" /> 步驟二：發放據點
              </div>
              <div className="card-body">
                <label className="form-label">據點 *</label>
                {isAdmin ? (
                  <select
                    className="form-select"
                    required
                    value={adminLocationId ?? ''}
                    onChange={(e) => changeLocation(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">請選擇據點</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.location_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input
                      className="form-control"
                      disabled
                      value={locations.find((l) => l.id === effectiveLocationId)?.location_name ?? ''}
                    />
                    <div className="form-text">
                      只有最高權限管理人員可以切換據點；您的帳號只能發放所屬據點的物資。
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ---------- 步驟三：領用清單（批次） ---------- */}
            <div className="card shadow-sm mb-4">
              <div className="card-header bg-light d-flex justify-content-between align-items-center">
                <span>
                  <i className="bi bi-list-check" /> 步驟三：領用清單
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={!effectiveLocationId}
                  onClick={() => {
                    setError(null)
                    setShowItemModal(true)
                  }}
                >
                  <i className="bi bi-plus-circle" /> 新增物資
                </button>
              </div>
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>物資</th>
                      <th className="col-min">規格／批次</th>
                      <th className="col-min">庫存</th>
                      <th className="col-min" style={{ width: 140 }}>
                        領用數量
                      </th>
                      <th className="col-min" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center text-muted py-4">
                          {effectiveLocationId
                            ? '尚未加入任何物資，請按右上角「新增物資」'
                            : '請先選擇發放據點'}
                        </td>
                      </tr>
                    ) : (
                      lines.map((l) => {
                        const alert = expiryAlert(l.item)
                        const over = l.quantity > l.item.quantity
                        return (
                          <tr key={l.item.id}>
                            <td>
                              <strong>{l.item.item_name}</strong>
                              <div className="text-muted small">{l.item.category}</div>
                            </td>
                            <td className="col-min">
                              {l.item.specification?.trim() || '無'}
                              {alert && <span className={`badge ms-1 ${alert.badgeClass}`}>{alert.label}</span>}
                            </td>
                            <td className="col-min">
                              {l.item.quantity} {l.item.unit ?? ''}
                            </td>
                            <td className="col-min">
                              <input
                                className={`form-control form-control-sm ${over ? 'is-invalid' : ''}`}
                                type="number"
                                min={1}
                                max={l.item.quantity}
                                value={l.quantity}
                                onChange={(e) => updateLineQuantity(l.item.id, e.target.value)}
                              />
                            </td>
                            <td className="col-min text-end">
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-danger"
                                onClick={() => removeLine(l.item.id)}
                                title="移除"
                              >
                                <i className="bi bi-trash" />
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                  {lines.length > 0 && (
                    <tfoot className="table-light">
                      <tr>
                        <td colSpan={3} className="text-end fw-bold">
                          合計
                        </td>
                        <td className="fw-bold">
                          {lines.length} 項／{totalQuantity} 件
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* ---------- 其他 ---------- */}
            <div className="card shadow-sm">
              <div className="card-body">
                <div className="mb-3">
                  <label className="form-label">操作人員</label>
                  <input className="form-control" disabled value={operatorName} />
                  <div className="form-text">系統會自動記錄目前登入帳號為操作人員。</div>
                </div>

                <div className="mb-3">
                  <label className="form-label">備註</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    placeholder="發放原因或其他說明（整批共用）"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                  />
                </div>

                <div className="d-flex gap-2">
                  <button type="submit" className="btn btn-primary btn-lg" disabled={submitting || lines.length === 0}>
                    <i className="bi bi-check-circle" /> 確認領用（{lines.length} 項）
                  </button>
                  <Link className="btn btn-secondary btn-lg" to="/outbound">
                    ← 返回紀錄
                  </Link>
                </div>
              </div>
            </div>
          </form>
        </div>

        <div className="col-lg-4">
          <div className="alert alert-info">
            <strong>
              <i className="bi bi-info-circle" /> 領用說明
            </strong>
            <ul className="mb-0 mt-2">
              <li>以領用人為主體：先填人的資料，再一項一項加入要派送的物資</li>
              <li>物資清單只會顯示您所屬據點的庫存；只有最高權限管理人員能切換據點</li>
              <li>同一個批次重複加入會自動累加數量</li>
              <li>整批在同一個交易裡扣庫存，其中一項不足會整批取消</li>
            </ul>
          </div>
          <div className="alert alert-warning">
            <strong>
              <i className="bi bi-exclamation-triangle" /> 注意事項
            </strong>
            <ul className="mb-0 mt-2">
              <li>請確認每一項的領用數量正確</li>
              <li>領用後無法直接復原</li>
              <li>建議填寫領用人聯絡方式以利後續追蹤</li>
            </ul>
          </div>
        </div>
      </div>

      {showDistrictModal && (
        <DistrictPickerModal
          currentPrecinct={recipientPrecinct}
          currentDistrict={recipientDistrict}
          onCancel={() => setShowDistrictModal(false)}
          onSelect={(precinct, district) => {
            setRecipientPrecinct(precinct)
            setRecipientDistrict(district)
            setShowDistrictModal(false)
          }}
        />
      )}

      {showItemModal && (
        <OutboundItemPickerModal
          items={pickerItems}
          loading={pickerLoading}
          remainingOf={remainingOf}
          onCancel={() => setShowItemModal(false)}
          onAdd={addLine}
        />
      )}

      {showConfirmModal && (
        <OutboundConfirmModal
          recipientName={recipientName}
          recipientContact={recipientContact}
          recipientPrecinct={recipientPrecinct}
          recipientDistrict={recipientDistrict}
          recipientIdentity={recipientIdentity}
          locationName={locations.find((l) => l.id === effectiveLocationId)?.location_name ?? ''}
          operatorName={operatorName}
          remark={remark}
          lines={lines}
          submitting={submitting}
          onCancel={() => setShowConfirmModal(false)}
          onConfirm={() => void doSubmit()}
        />
      )}
    </div>
  )
}

export function SupplyOutboundIndex() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const [logs, setLogs] = useState<SupplyOutboundLog[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [items, setItems] = useState<SupplyItem[]>([])
  const [keyword, setKeyword] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [identityFilter, setIdentityFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'cancelled'>('')
  const [itemFilter, setItemFilter] = useState('')
  const [loading, setLoading] = useState(true)
  // 取消領用
  const [cancelTarget, setCancelTarget] = useState<SupplyOutboundLog | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'danger'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [logRes, locRes, itemRes] = await Promise.all([
      supabase.from('supply_outbound_log').select('*').order('outbound_time', { ascending: false }).limit(100),
      supabase.from('supply_location').select('*'),
      supabase.from('supply_item').select('id, item_name, specification, unit'),
    ])
    setLogs((logRes.data ?? []) as SupplyOutboundLog[])
    setLocations((locRes.data ?? []) as SupplyLocation[])
    setItems((itemRes.data ?? []) as SupplyItem[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function itemOf(id: number): SupplyItem | undefined {
    return items.find((i) => i.id === id)
  }

  // 物資品項篩選是按「品名」比對（不是 supply_item_id）—— 同一個品名底下可能有
  // 好幾個批次（不同規格／效期各一列），使用者想找的是「米」，不是「某一批米」。
  // 找不到對應資料時的 fallback 文字要跟下拉選項用同一份，否則會對不起來。
  function itemNameOf(id: number): string {
    return itemOf(id)?.item_name ?? `物資 #${id}`
  }

  // 下拉選項只列「目前這批紀錄裡真的出現過的品項」，並附上筆數，
  // 避免把整個物資目錄倒出來（大多數品項在這 100 筆裡根本沒出現）。
  const itemOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of logs) {
      const name = itemNameOf(l.supply_item_id)
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, items])

  // 取消權限比照 outbound-cancel Edge Function：管理員不限據點，
  // 其他角色只能取消自己據點發出去的。前端只是把按鈕藏起來，真正的把關在後端。
  function canCancel(log: SupplyOutboundLog): boolean {
    if (log.is_cancelled) return false
    return isAdmin || profile?.location_id === log.location_id
  }

  // 同一批次還有幾項（不含這一筆）—— 用來提醒使用者「只會取消這一項」。
  function sameBatchCount(log: SupplyOutboundLog): number {
    if (!log.batch_id) return 0
    return logs.filter((l) => l.batch_id === log.batch_id && l.id !== log.id && !l.is_cancelled).length
  }

  async function confirmCancel(reason: string) {
    if (!cancelTarget) return
    setCancelling(true)
    const { data, error } = await supabase.functions.invoke('outbound-cancel', {
      body: { logId: cancelTarget.id, reason },
    })
    setCancelling(false)
    setCancelTarget(null)
    if (error || !data?.success) {
      setMessage({ type: 'danger', text: data?.message ?? (await functionErrorMessage(error, '取消失敗')) })
      return
    }
    setMessage({ type: 'success', text: data.message })
    await load()
  }

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (locationFilter && l.location_id !== Number(locationFilter)) return false
      if (identityFilter && l.recipient_identity !== identityFilter) return false
      if (itemFilter && itemNameOf(l.supply_item_id) !== itemFilter) return false
      if (statusFilter === 'active' && l.is_cancelled) return false
      if (statusFilter === 'cancelled' && !l.is_cancelled) return false
      if (keyword.trim()) {
        const k = keyword.trim().toLowerCase()
        const name = itemOf(l.supply_item_id)?.item_name ?? ''
        if (
          !l.recipient_name.toLowerCase().includes(k) &&
          !(l.recipient_contact ?? '').toLowerCase().includes(k) &&
          !(l.recipient_district ?? '').toLowerCase().includes(k) &&
          !(l.recipient_precinct ?? '').toLowerCase().includes(k) &&
          !(l.operator ?? '').toLowerCase().includes(k) &&
          !(l.remark ?? '').toLowerCase().includes(k) &&
          !name.toLowerCase().includes(k)
        )
          return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, keyword, locationFilter, identityFilter, itemFilter, statusFilter, items])

  function locationName(id: number): string {
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  function handleExport() {
    exportToExcel<SupplyOutboundLog>('領用紀錄', '領用紀錄', [
      { header: '領用時間', value: (l) => new Date(l.outbound_time).toLocaleString('zh-TW') },
      { header: '物資名稱', value: (l) => itemOf(l.supply_item_id)?.item_name ?? `物資 #${l.supply_item_id}` },
      { header: '規格', value: (l) => itemOf(l.supply_item_id)?.specification ?? '' },
      { header: '來源據點', value: (l) => locationName(l.location_id) },
      { header: '領用數量', value: (l) => l.outbound_quantity },
      { header: '單位', value: (l) => itemOf(l.supply_item_id)?.unit ?? '' },
      { header: '領用人', value: (l) => l.recipient_name },
      { header: '聯絡方式', value: (l) => l.recipient_contact ?? '' },
      { header: '區', value: (l) => l.recipient_precinct ?? '' },
      { header: '所屬鄉鎮', value: (l) => l.recipient_district ?? '' },
      { header: '身分別', value: (l) => recipientIdentityDisplayName(l.recipient_identity) },
      { header: '操作人員', value: (l) => l.operator ?? '' },
      { header: '備註', value: (l) => l.remark ?? '' },
      { header: '狀態', value: (l) => (l.is_cancelled ? '已取消' : '已領用') },
      { header: '取消時間', value: (l) => (l.cancelled_at ? new Date(l.cancelled_at).toLocaleString('zh-TW') : '') },
      { header: '取消人員', value: (l) => l.cancelled_by ?? '' },
      { header: '取消原因', value: (l) => l.cancel_reason ?? '' },
    ], filtered)
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">
          <i className="bi bi-list-ul" /> 物資領用紀錄
        </h2>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-success" onClick={handleExport} disabled={filtered.length === 0}>
            <i className="bi bi-file-earmark-excel" /> 匯出 Excel
          </button>
          <Link className="btn btn-outline-primary" to="/outbound/recipient-analysis">
            <i className="bi bi-graph-up" /> 查看領取分析
          </Link>
          <Link className="btn btn-primary" to="/outbound/create">
            <i className="bi bi-plus-circle" /> 新增領用
          </Link>
        </div>
      </div>
      <FlashMessage />
      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}
      <div className="card shadow-sm mb-3">
        <div className="card-header bg-light">
          <i className="bi bi-funnel" /> 篩選條件
        </div>
        <div className="card-body">
          {/* 六個欄位，md 以上排成兩列各三個（原本一列硬塞五個會擠爆並自己折行）。 */}
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">關鍵字</label>
              <input className="form-control" placeholder="搜尋領用人、聯絡方式、鄉鎮或物資" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="col-md-4">
              <label className="form-label">物資品項</label>
              <select className="form-select" value={itemFilter} onChange={(e) => setItemFilter(e.target.value)}>
                <option value="">全部物資品項</option>
                {itemOptions.map(([name, count]) => (
                  <option key={name} value={name}>
                    {name}（{count} 筆）
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">據點</label>
              <select className="form-select" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                <option value="">全部據點</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.location_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">身分別</label>
              <select className="form-select" value={identityFilter} onChange={(e) => setIdentityFilter(e.target.value)}>
                <option value="">全部身分別</option>
                {AllRecipientIdentities.map((idv) => (
                  <option key={idv} value={idv}>
                    {recipientIdentityDisplayName(idv)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">狀態</label>
              <select
                className="form-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as '' | 'active' | 'cancelled')}
              >
                <option value="">全部狀態</option>
                <option value="active">已領用</option>
                <option value="cancelled">已取消</option>
              </select>
            </div>
            <div className="col-md-4 d-flex align-items-end">
              <button
                type="button"
                className="btn btn-secondary w-100"
                onClick={() => {
                  setKeyword('')
                  setLocationFilter('')
                  setIdentityFilter('')
                  setItemFilter('')
                  setStatusFilter('')
                }}
              >
                <i className="bi bi-arrow-clockwise" /> 重設
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="card shadow-sm">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover">
              <thead className="table-light">
                <tr>
                  <th className="col-min">領用時間</th>
                  <th>物資名稱</th>
                  <th className="col-min">來源據點</th>
                  <th className="col-min">領用數量</th>
                  <th>領用人</th>
                  <th>聯絡方式</th>
                  <th className="col-min">所屬鄉鎮</th>
                  <th className="col-min">身分別</th>
                  <th className="col-min">操作人員</th>
                  <th>備註</th>
                  <th className="col-min">狀態</th>
                  <th className="col-min">動作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={12} className="text-center text-muted py-4">
                      載入中…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="text-center text-muted py-4">
                      沒有符合條件的領用紀錄
                    </td>
                  </tr>
                ) : (
                  filtered.map((log) => (
                    // 已取消的整列淡化 + 刪除線，一眼看得出這筆不算數
                    <tr key={log.id} className={log.is_cancelled ? 'text-muted' : undefined}>
                      <td className="col-min">{new Date(log.outbound_time).toLocaleString('zh-TW')}</td>
                      <td>
                        <strong>{itemOf(log.supply_item_id)?.item_name ?? `物資 #${log.supply_item_id}`}</strong>
                        {itemOf(log.supply_item_id)?.specification ? (
                          <span className="text-muted"> ／{itemOf(log.supply_item_id)?.specification}</span>
                        ) : null}
                        {log.batch_id && (
                          <span className="badge bg-light text-dark border ms-1" title="同一次批次領用">
                            <i className="bi bi-collection" /> 批次
                          </span>
                        )}
                      </td>
                      <td className="col-min">
                        <span className="badge" style={locationColorStyle(log.location_id)}>
                          {locationName(log.location_id)}
                        </span>
                      </td>
                      <td className="col-min">
                        <span style={log.is_cancelled ? { textDecoration: 'line-through' } : undefined}>
                          <strong>{log.outbound_quantity}</strong> {itemOf(log.supply_item_id)?.unit ?? ''}
                        </span>
                      </td>
                      <td>{log.recipient_name}</td>
                      <td>{log.recipient_contact}</td>
                      <td className="col-min">
                        {log.recipient_district ?? ''}
                        {log.recipient_precinct && (
                          <div className="text-muted small">{log.recipient_precinct}</div>
                        )}
                      </td>
                      <td className="col-min">
                        {log.recipient_identity && (
                          <span className={`badge ${recipientIdentityBadgeClass(log.recipient_identity)}`}>
                            {recipientIdentityDisplayName(log.recipient_identity)}
                          </span>
                        )}
                      </td>
                      <td className="col-min">{log.operator}</td>
                      <td>{log.remark}</td>
                      <td className="col-min">
                        {log.is_cancelled ? (
                          <>
                            <span className="badge bg-secondary">已取消</span>
                            <div className="small">
                              {log.cancelled_by}
                              {log.cancelled_at && <br />}
                              {log.cancelled_at && new Date(log.cancelled_at).toLocaleString('zh-TW')}
                            </div>
                            {log.cancel_reason && <div className="small fst-italic">{log.cancel_reason}</div>}
                          </>
                        ) : (
                          <span className="badge bg-success">已領用</span>
                        )}
                      </td>
                      <td className="col-min">
                        {canCancel(log) && (
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm"
                            onClick={() => {
                              setMessage(null)
                              setCancelTarget(log)
                            }}
                          >
                            <i className="bi bi-arrow-counterclockwise" /> 取消
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {cancelTarget && (
        <OutboundCancelModal
          itemLabel={
            itemOf(cancelTarget.supply_item_id)
              ? `${itemOf(cancelTarget.supply_item_id)?.item_name}${
                  itemOf(cancelTarget.supply_item_id)?.specification
                    ? `／${itemOf(cancelTarget.supply_item_id)?.specification}`
                    : ''
                }`
              : `物資 #${cancelTarget.supply_item_id}`
          }
          quantityLabel={`${cancelTarget.outbound_quantity} ${itemOf(cancelTarget.supply_item_id)?.unit ?? ''}`}
          recipientName={cancelTarget.recipient_name}
          locationName={locationName(cancelTarget.location_id)}
          outboundTime={new Date(cancelTarget.outbound_time).toLocaleString('zh-TW')}
          sameBatchCount={sameBatchCount(cancelTarget)}
          submitting={cancelling}
          onCancel={() => setCancelTarget(null)}
          onConfirm={(reason) => void confirmCancel(reason)}
        />
      )}
    </div>
  )
}

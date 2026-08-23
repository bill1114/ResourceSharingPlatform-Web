// 物資出庫「領用人所屬鄉鎮」與「身分別」的定義。
//
// 刻意不放進 lib/enums.ts：enums.ts 被 12 個檔案 import（Architecture.md §三 C 級），
// 動它每個人都要重測。這兩組值目前只有出庫這條切片在用，先獨立成一個檔，
// 之後若捐贈／報廢也要用同一組鄉鎮，再搬進 enums.ts 即可。
//
// 分局區劃分依雲林縣警察局的六個分局轄區，涵蓋雲林縣全部 20 個鄉鎮市
// （1 市 5 鎮 14 鄉），沒有重複也沒有遺漏。這只是預設值，之後可直接改這張表。

export interface Precinct {
  /** 存進 supply_outbound_log.recipient_precinct 的值 */
  name: string
  /** 該分局負責的鄉鎮市，存進 supply_outbound_log.recipient_district */
  townships: string[]
}

export const YunlinPrecincts: Precinct[] = [
  { name: '斗六分局', townships: ['斗六市', '林內鄉', '莿桐鄉', '古坑鄉'] },
  { name: '斗南分局', townships: ['斗南鎮', '大埤鄉'] },
  { name: '虎尾分局', townships: ['虎尾鎮', '土庫鎮', '褒忠鄉', '元長鄉'] },
  { name: '西螺分局', townships: ['西螺鎮', '二崙鄉', '崙背鄉'] },
  { name: '北港分局', townships: ['北港鎮', '水林鄉', '口湖鄉', '四湖鄉'] },
  { name: '台西分局', townships: ['臺西鄉', '麥寮鄉', '東勢鄉'] },
]

/** 給定鄉鎮市，反查它屬於哪個分局區（找不到回傳 null）。 */
export function precinctOfTownship(township: string | null | undefined): string | null {
  if (!township) return null
  return YunlinPrecincts.find((p) => p.townships.includes(township))?.name ?? null
}

// 身分別：比照 enums.ts 的慣例，DB 存英文碼、畫面顯示中文。
export const RecipientIdentities = {
  LowIncome: 'LowIncome',
  MidLowIncome: 'MidLowIncome',
  General: 'General',
  Other: 'Other',
} as const
export type RecipientIdentity = (typeof RecipientIdentities)[keyof typeof RecipientIdentities]
export const AllRecipientIdentities: RecipientIdentity[] = [
  RecipientIdentities.LowIncome,
  RecipientIdentities.MidLowIncome,
  RecipientIdentities.General,
  RecipientIdentities.Other,
]

export function recipientIdentityDisplayName(identity: string | null | undefined): string {
  switch (identity) {
    case RecipientIdentities.LowIncome:
      return '低收入戶'
    case RecipientIdentities.MidLowIncome:
      return '中低收入戶'
    case RecipientIdentities.General:
      return '一般戶'
    case RecipientIdentities.Other:
      return '其他'
    default:
      return identity ?? ''
  }
}

export function recipientIdentityBadgeClass(identity: string | null | undefined): string {
  switch (identity) {
    case RecipientIdentities.LowIncome:
      return 'bg-danger'
    case RecipientIdentities.MidLowIncome:
      return 'bg-warning text-dark'
    case RecipientIdentities.General:
      return 'bg-secondary'
    case RecipientIdentities.Other:
      return 'bg-dark'
    default:
      return 'bg-light text-dark'
  }
}


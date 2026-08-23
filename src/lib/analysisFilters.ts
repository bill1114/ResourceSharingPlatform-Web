// 領取分析「Excel 式篩選」的類別定義與型別。
// 與 components/AnalysisFilterModal.tsx 分開放，理由跟 lib/stockBatch.ts 一樣：
// 那支只放元件，非元件的 export 混進去會讓 Vite 的 fast refresh 失效
// （見 oxlint 的 react/only-export-components）。

export const FilterFields = {
  Recipient: 'recipient',
  Identity: 'identity',
  District: 'district',
  Item: 'item',
} as const
export type FilterField = (typeof FilterFields)[keyof typeof FilterFields]

export const FilterFieldLabels: Record<FilterField, string> = {
  recipient: '使用人',
  identity: '身分別',
  district: '鄉鎮別',
  item: '物資品項',
}

export const FilterFieldIcons: Record<FilterField, string> = {
  recipient: 'bi-person',
  identity: 'bi-award',
  district: 'bi-geo-alt',
  item: 'bi-box-seam',
}

export const AllFilterFields: FilterField[] = [
  FilterFields.Recipient,
  FilterFields.Identity,
  FilterFields.District,
  FilterFields.Item,
]

/** 一條生效中的篩選條件：某個類別 + 被勾選的值。同類別內 OR、不同類別間 AND。 */
export interface AnalysisFilter {
  field: FilterField
  values: string[]
}

/**
 * 資料裡沒填該欄位時用的哨兵值，顯示成「（未填）」。
 * 開頭的空白是刻意的：真實資料不會是這個字串，才不會誤判。
 */
export const EMPTY_VALUE = ' empty'

/** 彈窗裡的一個選項：value 是比對用的字串，label 是畫面文字，count 是筆數。 */
export interface FilterOption {
  value: string
  label: string
  count: number
}


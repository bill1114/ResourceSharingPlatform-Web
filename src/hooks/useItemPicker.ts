// Shared "pick an existing stock batch" cascade used by 出庫/捐贈/報廢 create
// forms — mirrors Views/SupplyOutbound/Create.cshtml's pattern of cascading over
// actual SupplyItem rows (not catalog variants, since these operations act on a
// concrete stock batch with its own quantity/expiry), scoped to one location.
//
// `stockTypeFilter` (optional) backs 物資出庫's 分類 quick-switch: it narrows the
// cascade client-side without re-querying, and `availableStockTypes` lets the
// caller grey out a 分類 that has no stock at the selected location. Callers that
// don't pass it (捐贈/報廢) behave exactly as before.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { SupplyItem } from '../types/db'

function uniqueInOrder<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

export function useItemPicker(locationId: number | null, stockTypeFilter?: string) {
  const [items, setItems] = useState<SupplyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [category, setCategoryRaw] = useState('')
  const [itemName, setItemNameRaw] = useState('')
  const [itemId, setItemId] = useState<number | null>(null)

  useEffect(() => {
    async function load() {
      if (!locationId) {
        setItems([])
        setLoading(false)
        return
      }
      setLoading(true)
      const { data } = await supabase
        .from('supply_item')
        .select('*')
        .eq('is_active', true)
        .eq('location_id', locationId)
        .gt('quantity', 0)
        .order('expiration_date', { ascending: true, nullsFirst: false })
      setItems((data ?? []) as SupplyItem[])
      setLoading(false)
    }
    void load()
    setCategoryRaw('')
    setItemNameRaw('')
    setItemId(null)
  }, [locationId, refreshKey])

  // 分類篩選只縮小「可挑選」的範圍；currentItem 仍然查完整的 items，這樣快選
  // 帶進來的批次不會因為分類還停在別的分頁就查不到。
  const scopedItems = useMemo(
    () => items.filter((i) => !stockTypeFilter || i.stock_type === stockTypeFilter),
    [items, stockTypeFilter]
  )
  const availableStockTypes = useMemo(() => new Set(items.map((i) => i.stock_type)), [items])

  const categories = useMemo(() => uniqueInOrder(scopedItems.map((i) => i.category)).sort(), [scopedItems])
  const itemNames = useMemo(
    () => uniqueInOrder(scopedItems.filter((i) => i.category === category).map((i) => i.item_name)).sort(),
    [scopedItems, category]
  )
  // items 已依效期由近到遠排序，batches 沿用同一順序 —— 即期的批次會排在最前面。
  const batches = useMemo(
    () => scopedItems.filter((i) => i.category === category && i.item_name === itemName),
    [scopedItems, category, itemName]
  )
  const currentItem = useMemo(() => items.find((i) => i.id === itemId) ?? null, [items, itemId])

  function setCategory(value: string) {
    setCategoryRaw(value)
    setItemNameRaw('')
    setItemId(null)
  }
  function setItemName(value: string) {
    setItemNameRaw(value)
    setItemId(null)
  }
  function reset() {
    setCategoryRaw('')
    setItemNameRaw('')
    setItemId(null)
  }
  // 出庫成功後要重新讀取庫存數量（順帶清空已選內容）。
  function reload() {
    setRefreshKey((x) => x + 1)
  }

  return {
    loading,
    items,
    categories,
    itemNames,
    batches,
    availableStockTypes,
    category,
    itemName,
    itemId,
    currentItem,
    setCategory,
    setItemName,
    setItemId,
    reset,
    reload,
  }
}

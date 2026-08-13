// Shared "pick an existing stock batch" cascade used by 出庫/捐贈/報廢 create
// forms — mirrors Views/SupplyOutbound/Create.cshtml's pattern of cascading over
// actual SupplyItem rows (not catalog variants, since these operations act on a
// concrete stock batch with its own quantity/expiry), scoped to one location.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { SupplyItem } from '../types/db'

function uniqueInOrder<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

export function useItemPicker(locationId: number | null) {
  const [items, setItems] = useState<SupplyItem[]>([])
  const [loading, setLoading] = useState(true)
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
  }, [locationId])

  const categories = useMemo(() => uniqueInOrder(items.map((i) => i.category)).sort(), [items])
  const itemNames = useMemo(
    () => uniqueInOrder(items.filter((i) => i.category === category).map((i) => i.item_name)).sort(),
    [items, category]
  )
  const batches = useMemo(
    () => items.filter((i) => i.category === category && i.item_name === itemName),
    [items, category, itemName]
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

  function batchLabel(item: SupplyItem): string {
    const spec = item.specification ? `｜${item.specification}` : ''
    const expiry = item.expiration_date ? `｜效期 ${item.expiration_date}` : ''
    return `現有 ${item.quantity} ${item.unit ?? ''}${spec}${expiry}`
  }

  return {
    loading,
    items,
    categories,
    itemNames,
    batches,
    category,
    itemName,
    itemId,
    currentItem,
    setCategory,
    setItemName,
    setItemId,
    batchLabel,
  }
}

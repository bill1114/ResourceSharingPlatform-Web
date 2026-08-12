// Replaces the two hand-rolled, independently-duplicated inline-JS cascading
// Category -> ItemName -> Specification dropdowns from Views/SupplyItem/Create.cshtml
// and Views/SupplyOutbound/Create.cshtml — one hook, used by every screen that needs
// this pattern (物資管理, 出庫, AI 智慧入庫 confirm, 庫存種類設定).
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { InventoryItemDefinition, InventoryItemVariant } from '../types/db'

function uniqueInOrder<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

export function useCascadingCatalog(stockTypeFilter?: string | null) {
  const [definitions, setDefinitions] = useState<InventoryItemDefinition[]>([])
  const [variants, setVariants] = useState<InventoryItemVariant[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategoryRaw] = useState('')
  const [itemName, setItemNameRaw] = useState('')
  const [variantId, setVariantId] = useState<number | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [defRes, varRes] = await Promise.all([
        supabase.from('inventory_item_definition').select('*').eq('is_active', true),
        supabase.from('inventory_item_variant').select('*').eq('is_active', true),
      ])
      setDefinitions((defRes.data ?? []) as InventoryItemDefinition[])
      setVariants((varRes.data ?? []) as InventoryItemVariant[])
      setLoading(false)
    }
    void load()
  }, [])

  const scopedDefinitions = useMemo(
    () => definitions.filter((d) => !stockTypeFilter || d.stock_type === stockTypeFilter),
    [definitions, stockTypeFilter]
  )

  const categories = useMemo(
    () => uniqueInOrder(scopedDefinitions.map((d) => d.category)).sort(),
    [scopedDefinitions]
  )

  const itemNames = useMemo(
    () =>
      uniqueInOrder(scopedDefinitions.filter((d) => d.category === category).map((d) => d.item_name)).sort(),
    [scopedDefinitions, category]
  )

  const currentDefinition = useMemo(
    () => scopedDefinitions.find((d) => d.category === category && d.item_name === itemName) ?? null,
    [scopedDefinitions, category, itemName]
  )

  const specVariants = useMemo(
    () =>
      currentDefinition
        ? variants.filter((v) => v.inventory_item_definition_id === currentDefinition.id)
        : [],
    [variants, currentDefinition]
  )

  const currentVariant = useMemo(
    () => specVariants.find((v) => v.id === variantId) ?? null,
    [specVariants, variantId]
  )

  // Switching category clears item/spec since the available options change
  // (mirrors the .NET views' "切換分類會清空已選的內容" note).
  function setCategory(value: string) {
    setCategoryRaw(value)
    setItemNameRaw('')
    setVariantId(null)
  }

  function setItemName(value: string) {
    setItemNameRaw(value)
    setVariantId(null)
  }

  function reset() {
    setCategoryRaw('')
    setItemNameRaw('')
    setVariantId(null)
  }

  return {
    loading,
    definitions,
    variants,
    categories,
    itemNames,
    specVariants,
    category,
    itemName,
    variantId,
    currentDefinition,
    currentVariant,
    setCategory,
    setItemName,
    setVariantId,
    reset,
  }
}

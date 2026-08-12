// TS port of Models/LocationColors.cs and Models/CategoryColors.cs.
// Palettes and the modulo/hash formulas are copied exactly so badge colors are
// deterministic and stable across reloads (same intent as the C# originals).
import type { CSSProperties } from 'react'

type ColorPair = { bg: string; text: string }

const LOCATION_PALETTE: ColorPair[] = [
  { bg: '#0d6efd', text: '#fff' }, // blue
  { bg: '#6f42c1', text: '#fff' }, // purple
  { bg: '#d63384', text: '#fff' }, // pink
  { bg: '#fd7e14', text: '#000' }, // orange
  { bg: '#20c997', text: '#000' }, // teal
  { bg: '#6610f2', text: '#fff' }, // indigo
  { bg: '#198754', text: '#fff' }, // green
  { bg: '#0dcaf0', text: '#000' }, // cyan
]

export function getLocationColor(locationId: number): ColorPair {
  const len = LOCATION_PALETTE.length
  const index = (((locationId - 1) % len) + len) % len
  return LOCATION_PALETTE[index]
}

export function locationColorStyle(locationId: number): CSSProperties {
  const { bg, text } = getLocationColor(locationId)
  return { backgroundColor: bg, color: text }
}

const CATEGORY_PALETTE: ColorPair[] = [
  { bg: '#ffb703', text: '#000' }, // amber
  { bg: '#8ecae6', text: '#000' }, // sky blue
  { bg: '#ff8fa3', text: '#000' }, // rose
  { bg: '#06d6a0', text: '#000' }, // mint
  { bg: '#9d4edd', text: '#fff' }, // violet
  { bg: '#f4a261', text: '#000' }, // orange
  { bg: '#457b9d', text: '#fff' }, // slate blue
  { bg: '#c9184a', text: '#fff' }, // crimson
]

// Category is free-text (no stable numeric Id), so pick a color from a hash of the
// string. Forces 32-bit signed-integer overflow at each step (`| 0`) to match C#'s
// `unchecked` int arithmetic in CategoryColors.StableHash exactly, rather than letting
// JS numbers silently grow into imprecise floats for long strings.
function stableHash(value: string): number {
  let hash = 17
  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0
  }
  return hash
}

export function getCategoryColor(category: string | null | undefined): ColorPair {
  if (!category) {
    return CATEGORY_PALETTE[0]
  }
  const len = CATEGORY_PALETTE.length
  const index = ((stableHash(category) % len) + len) % len
  return CATEGORY_PALETTE[index]
}

export function categoryColorStyle(category: string | null | undefined): CSSProperties {
  const { bg, text } = getCategoryColor(category)
  return { backgroundColor: bg, color: text }
}

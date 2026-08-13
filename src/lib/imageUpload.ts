// Port of SupplyItemController.SaveImageAsync's naming convention:
// {種類}-{名稱}-{規格}-{數量}-{日期}-{流水號}.{副檔名}, e.g.
// 食品-飲用水-600ml-250-20260809-001.png — see migration plan §六.
//
// DEVIATION FROM THE PLAN, discovered via a live test (2026-08-13): Supabase
// Storage object keys reject non-ASCII characters outright (confirmed via a
// direct API call — a pure-Chinese key returns 400 InvalidKey; an ASCII key
// passes validation). The .NET app's filenames embed raw Chinese text
// (物資種類-物資名稱-規格-...), which the Windows filesystem allows but
// Supabase Storage's key validator does not. Since almost every
// category/item_name/specification value in this app IS Chinese text with no
// ASCII fallback, "sanitize and keep the Chinese" (the .NET approach) isn't
// viable here — instead this strips non-ASCII characters, and always
// includes the numeric inventory_item_definition id so the filename stays
// unique/traceable even when every text field gets stripped down to nothing
// (the common case). The human-readable category/name/spec is still recorded
// properly in supply_item's own columns; the filename no longer needs to
// duplicate it verbatim now that files are browsed through the app, not a
// Windows folder.
import { supabase } from './supabaseClient'

// Keeps only ASCII letters/digits (Chinese and other non-ASCII text is
// dropped, not replaced by a placeholder) and collapses everything else to
// '_'. Different from the .NET SanitizeForFileName (which only stripped
// filesystem-illegal characters and kept Chinese) precisely because of the
// Supabase Storage key restriction described above.
export function sanitizeForFileName(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0')
}

async function nextSequence(bucket: string, prefix: string): Promise<number> {
  const { data, error } = await supabase.storage.from(bucket).list('', { search: prefix })
  if (error || !data) return 1
  let max = 0
  for (const f of data) {
    const m = f.name.match(new RegExp(`^${prefix}-(\\d{3})\\.[a-zA-Z0-9]+$`))
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return max + 1
}

export async function uploadItemPhoto(
  file: File,
  fields: { definitionId: number; category: string; itemName: string; specification: string | null; quantity: number }
): Promise<{ path: string; error: string | null }> {
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  const asciiParts = [
    sanitizeForFileName(fields.category),
    sanitizeForFileName(fields.itemName),
    sanitizeForFileName(fields.specification),
  ].filter(Boolean)

  const parts = [`def${fields.definitionId}`, ...asciiParts, fields.quantity.toString(), dateStr]
  const prefix = parts.join('-')

  const seq = await nextSequence('items', prefix)
  const fileName = `${prefix}-${pad3(seq)}.${ext}`

  const { error } = await supabase.storage.from('items').upload(fileName, file, { upsert: false })
  if (error) {
    return { path: '', error: error.message }
  }
  return { path: fileName, error: null }
}

export function itemPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null
  const { data } = supabase.storage.from('items').getPublicUrl(path)
  return data.publicUrl
}

export async function deleteItemPhoto(path: string | null | undefined): Promise<void> {
  if (!path) return
  await supabase.storage.from('items').remove([path])
}

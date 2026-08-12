// Port of SupplyItemController.SaveImageAsync's naming convention:
// {種類}-{名稱}-{規格}-{數量}-{日期}-{流水號}.{副檔名}, e.g.
// 食品-飲用水-600ml-250-20260809-001.png — see migration plan §六.
import { supabase } from './supabaseClient'

// Port of SupplyItemController.SanitizeForFileName: strip filesystem-illegal
// characters, replace literal '-' with '_' so it can't collide with the
// naming convention's own '-' field separators. Chinese characters pass
// through untouched.
export function sanitizeForFileName(value: string | null | undefined): string {
  if (!value) return ''
  // eslint-disable-next-line no-control-regex
  const illegal = /[\x00-\x1f<>:"/\\|?*]/g
  return value.replace(illegal, '_').replace(/-/g, '_')
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
  fields: { category: string; itemName: string; specification: string | null; quantity: number }
): Promise<{ path: string; error: string | null }> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  const dateStr = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '')
  const parts = [
    sanitizeForFileName(fields.category),
    sanitizeForFileName(fields.itemName),
    sanitizeForFileName(fields.specification || '無規格'),
    fields.quantity.toString(),
    dateStr,
  ].filter(Boolean)
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

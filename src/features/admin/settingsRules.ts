import type { Settings } from '../tasks/gateways'

/** The rows of `app_settings`: the key of a setting and the value that is kept for it, as JSON. */
export interface SettingRow {
  key: keyof Settings
  value: string | string[] | null
}

/**
 * What is to be written of a patch of the settings: one row for each setting that was given, with the
 * address trimmed and the names of the methods trimmed. A key that is not a setting is never written,
 * whatever the caller hands in.
 */
export function settingRows(patch: Partial<Settings>): SettingRow[] {
  const rows: SettingRow[] = []
  if (patch.glassix_url_template !== undefined) rows.push({ key: 'glassix_url_template', value: patch.glassix_url_template.trim() })
  if (patch.ship_methods !== undefined) rows.push({ key: 'ship_methods', value: patch.ship_methods.map((method) => method.trim()) })
  if (patch.last_backup_at !== undefined) rows.push({ key: 'last_backup_at', value: patch.last_backup_at })
  return rows
}

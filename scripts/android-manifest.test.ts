// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import config from '../capacitor.config'

const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
const permissions = () => [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((match) => match[1]).sort()

describe('the Android manifest', () => {
  it('lets the app find the camera, so that the "צלם" button opens it', () => {
    // The app targets Android 11 or later, which hides other apps unless the manifest asks to see them:
    // without this the camera is not found, and the button opens the file picker instead.
    const queries = manifest.match(/<queries>[\s\S]*?<\/queries>/)?.[0] ?? ''
    expect(queries).toContain('<action android:name="android.media.action.IMAGE_CAPTURE" />')
  })

  it('does not ask for the camera permission, which would make the capture button ask the person for it', () => {
    expect(manifest).not.toContain('android.permission.CAMERA')
  })

  it('keeps the file provider that the camera writes the picture to', () => {
    expect(manifest).toContain('androidx.core.content.FileProvider')
    expect(manifest).toContain('${applicationId}.fileprovider')
  })

  it('asks for the internet, and for what reminders need, and for nothing else', () => {
    // Android 13 asks the person before it shows a notification, Android 12 before an alarm goes off at
    // the minute, and a phone that is switched on again must get its pending reminders back. (The plugin
    // of the notifications adds the same permissions, but USE_EXACT_ALARM, to the app when it is built;
    // they are written here too, so that what the app asks for can be read in one place.)
    expect(permissions()).toEqual([
      'android.permission.INTERNET',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.USE_EXACT_ALARM',
    ])
  })

  // From Android 13 a permission of this kind is granted when the app is installed and cannot be taken
  // away, so a reminder is on time without a visit to the settings. Without it, Android 14 gives a new
  // install no exact alarms, and the person has to find the page "Alarms & reminders". It is meant for
  // alarm and calendar apps, which a reminder app for a service desk is; it is not a thing to ask for
  // from a store that checks that (the app is not on one: spec section 6).
  it('asks for exact alarms in the way that needs no visit to the settings from Android 13 on', () => {
    expect(manifest).toContain('<uses-permission android:name="android.permission.USE_EXACT_ALARM" />')
  })

  it('still has no permission for the camera, the contacts, the location or the storage', () => {
    for (const forbidden of ['CAMERA', 'READ_CONTACTS', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) {
      expect(manifest).not.toContain(`android.permission.${forbidden}`)
    }
  })

  it('has the small icon of the notifications, and tells the plugin to use it', () => {
    const icon = config.plugins?.LocalNotifications?.smallIcon
    expect(icon).toBe('ic_stat_moked')
    expect(existsSync(new URL(`../android/app/src/main/res/drawable/${icon}.xml`, import.meta.url))).toBe(true)
  })

  it('colours the small icon with the colour of the app', () => {
    expect(config.plugins?.LocalNotifications?.iconColor).toBe('#0e6b75')
  })
})

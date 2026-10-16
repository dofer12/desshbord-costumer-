// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')

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

  it('asks for the internet, and for nothing else', () => {
    const permissions = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((match) => match[1])
    expect(permissions).toEqual(['android.permission.INTERNET'])
  })
})

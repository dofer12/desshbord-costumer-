import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem, type FilesystemPlugin } from '@capacitor/filesystem'
import { Share, type SharePlugin } from '@capacitor/share'

// The part of the platform that hands a file to the person. A browser (and the window of the Windows app)
// downloads it through a link; the Android app writes it to its cache and opens the share sheet, from which
// the person sends it to Drive, to mail, or to the Files app. A person who changes their mind and closes
// the sheet has not saved anything, and the caller is told so.

export interface SavedFile {
  name: string
  mime: string
  content: string
}

/** What came of it: handed to the browser's download, handed to the share sheet, or the person gave up. */
export type SaveResult = 'saved' | 'shared' | 'cancelled'

export interface FileSaver {
  save(file: SavedFile): Promise<SaveResult>
}

/** How long the address of a download is kept: the browser starts the download at once, and the address is let go after it. */
const ADDRESS_KEPT_MS = 30_000

/**
 * Downloads the file with a temporary link, as a browser does for a file that the page made. The browser
 * does not say whether the person went through with it (a window that asks where to save can be closed),
 * so a click is "saved".
 */
export function createWebFileSaver(): FileSaver {
  return {
    async save(file) {
      const address = URL.createObjectURL(new Blob([file.content], { type: `${file.mime};charset=utf-8` }))
      const link = document.createElement('a')
      link.href = address
      link.download = file.name
      link.hidden = true
      document.body.append(link)
      try {
        link.click()
      } finally {
        link.remove()
        setTimeout(() => URL.revokeObjectURL(address), ADDRESS_KEPT_MS)
      }
      return 'saved'
    },
  }
}

/** The parts of the Capacitor plugins that are used, so that a test can put others in their place. */
export interface NativePlugins {
  filesystem: Pick<FilesystemPlugin, 'writeFile'>
  share: Pick<SharePlugin, 'share'>
}

/** A closed share sheet: Android and iOS say "Share canceled", and the browser's own API says that it was aborted. */
function wasCancelled(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : typeof error === 'object' && error !== null ? String((error as { message?: unknown }).message ?? '') : String(error)
  return /cancel|abort/i.test(text)
}

/**
 * Writes the file to the cache of the app and opens the share sheet for it. What the plugins say when they
 * fail is not passed on: it holds the path of the file on the phone, which is nobody's business.
 */
export function createNativeFileSaver(plugins: NativePlugins): FileSaver {
  return {
    async save(file) {
      let uri: string
      try {
        const written = await plugins.filesystem.writeFile({ path: file.name, data: file.content, directory: Directory.Cache, encoding: Encoding.UTF8 })
        uri = written.uri
      } catch (error) {
        // What the plugin says has the path of the file in it: it is kept as the cause and is never shown.
        throw new Error('The file could not be written.', { cause: error })
      }
      try {
        await plugins.share.share({ title: file.name, url: uri, dialogTitle: file.name })
        return 'shared'
      } catch (error) {
        if (wasCancelled(error)) return 'cancelled'
        throw new Error('The file could not be shared.', { cause: error })
      }
    },
  }
}

/** A saver for tests and the demo: it keeps the files that it is given and shows nothing. */
export interface MemoryFileSaver extends FileSaver {
  /** Every file it was given, in order. */
  files: SavedFile[]
  /** What the next saves say: "saved" until it is told otherwise. */
  setResult(result: SaveResult): void
  /** The next save fails with this error. */
  failNext(error: unknown): void
}

export function createMemoryFileSaver(): MemoryFileSaver {
  let result: SaveResult = 'saved'
  const failures: unknown[] = []
  const saver: MemoryFileSaver = {
    files: [],
    async save(file) {
      if (failures.length > 0) throw failures.shift()
      saver.files.push({ ...file })
      return result
    },
    setResult(next) {
      result = next
    },
    failNext(error) {
      failures.push(error)
    },
  }
  return saver
}

/** The saver of the platform the app runs on: the share sheet in the Android app, a download anywhere else. The arguments are for tests. */
export function chooseFileSaver(deps: { native?: boolean; plugins?: NativePlugins } = {}): FileSaver {
  const native = deps.native ?? Capacitor.isNativePlatform()
  return native ? createNativeFileSaver(deps.plugins ?? { filesystem: Filesystem, share: Share }) : createWebFileSaver()
}

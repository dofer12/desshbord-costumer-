import { onTestFinished, vi, type Mock } from 'vitest'

// jsdom can neither decode a picture nor draw one. This puts stand-ins for the two things that the
// resizing needs in place, createImageBitmap and a canvas that can be drawn on and encoded, and keeps a
// record of what was done with them. Everything is taken away again when the test is over.

interface Size {
  width: number
  height: number
}

export interface EncodedPicture extends Size {
  type: string
  quality: number
  blob: Blob
  /** The colour that the canvas was filled with before the picture was drawn on it. */
  background: string
}

type FillRect = (x: number, y: number, width: number, height: number) => void
type DrawImage = (picture: unknown, x: number, y: number, width: number, height: number) => void

export interface ImageApis {
  /** createImageBitmap, which reads the size of a picture from `sizeOf`, or from `camera` when nothing was said. */
  decode: Mock<(blob: Blob) => Promise<Size & { close(): void }>>
  fillRect: Mock<FillRect>
  drawImage: Mock<DrawImage>
  /** The settings of the drawing, as the code left them. */
  settings: { fillStyle: string; imageSmoothingEnabled: boolean; imageSmoothingQuality: string }
  /** The pictures that were encoded as a JPEG, in order. */
  encoded: EncodedPicture[]
  /** How many decoded pictures were let go. */
  readonly closed: number
  /** Tells what a file or a picture that was made here decodes to. */
  sizeOf(blob: Blob, width: number, height: number): void
  /** From now on a picture cannot be decoded: it is damaged, or of a kind the browser does not know. */
  failDecode(): void
  /** From now on the canvas has no 2d context. */
  noContext(): void
  /** From now on the canvas hands back nothing when it is asked for a JPEG. */
  failEncode(): void
}

/**
 * @param camera What a picture that nobody said anything about decodes to. The default is what the
 *   camera of a phone makes.
 */
export function stubImageApis(camera: Size = { width: 4000, height: 3000 }): ImageApis {
  const sizes = new WeakMap<Blob, Size>()
  const state = { closed: 0, decodeFails: false, noContext: false, encodeFails: false }
  const encoded: EncodedPicture[] = []
  const settings = { fillStyle: '', imageSmoothingEnabled: false, imageSmoothingQuality: 'low' }
  let background = ''

  const decode = vi.fn(async (blob: Blob) => {
    if (state.decodeFails) throw new DOMException('The source image could not be decoded.', 'InvalidStateError')
    return {
      ...(sizes.get(blob) ?? camera),
      close() {
        state.closed++
      },
    }
  })
  vi.stubGlobal('createImageBitmap', decode)

  const fillRect = vi.fn<FillRect>(() => {
    background = settings.fillStyle
  })
  const drawImage = vi.fn<DrawImage>()
  // One object is the context of every canvas.
  const context = {
    fillRect,
    drawImage,
    get fillStyle() {
      return settings.fillStyle
    },
    set fillStyle(value: string) {
      settings.fillStyle = value
    },
    get imageSmoothingEnabled() {
      return settings.imageSmoothingEnabled
    },
    set imageSmoothingEnabled(value: boolean) {
      settings.imageSmoothingEnabled = value
    },
    get imageSmoothingQuality() {
      return settings.imageSmoothingQuality
    },
    set imageSmoothingQuality(value: string) {
      settings.imageSmoothingQuality = value
    },
  }

  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(((kind: string) => (kind === '2d' && !state.noContext ? context : null)) as never)
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation(function (this: HTMLCanvasElement, callback: BlobCallback, type?: string, quality?: unknown) {
      void Promise.resolve().then(() => {
        if (state.encodeFails) {
          callback(null)
          return
        }
        const blob = new Blob([`${this.width}x${this.height}`], { type })
        sizes.set(blob, { width: this.width, height: this.height })
        encoded.push({ width: this.width, height: this.height, type: type ?? '', quality: Number(quality), blob, background })
        callback(blob)
      })
    })

  onTestFinished(() => {
    vi.unstubAllGlobals()
    getContext.mockRestore()
    toBlob.mockRestore()
  })

  return {
    decode,
    fillRect,
    drawImage,
    settings,
    encoded,
    get closed() {
      return state.closed
    },
    sizeOf(blob, width, height) {
      sizes.set(blob, { width, height })
    },
    failDecode() {
      state.decodeFails = true
    },
    noContext() {
      state.noContext = true
    },
    failEncode() {
      state.encodeFails = true
    },
  }
}

/** A picture as a file, of the size that the stand-ins above will decode it to. */
export function pictureFile(images: ImageApis, name = 'photo.jpg', size: Size = { width: 4000, height: 3000 }, type = 'image/jpeg'): File {
  const file = new File([name], name, { type })
  images.sizeOf(file, size.width, size.height)
  return file
}

/** The largest picture that is taken in, before it is made smaller. */
export const MAX_INPUT_BYTES = 15 * 1024 * 1024

export const IMAGE_MESSAGES = {
  notAnImage: 'הקובץ אינו תמונה.',
  tooBig: 'התמונה גדולה מדי. אפשר עד 15MB.',
  unreadable: 'לא הצלחנו לקרוא את התמונה.',
} as const

/**
 * The size a picture is made, so that its long side is at most `maxEdge` and its ratio is kept. A
 * picture that is not longer than that stays as it is: it is never enlarged.
 */
export function planResize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  // The long side is exactly the limit; the other one follows it, and is never nothing.
  return width >= height
    ? { width: maxEdge, height: Math.max(1, Math.round(height * scale)) }
    : { width: Math.max(1, Math.round(width * scale)), height: maxEdge }
}

/** Why a file cannot be added as a picture, in words for the person, or null when it can. */
export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('image/')) return IMAGE_MESSAGES.notAnImage
  if (file.size > MAX_INPUT_BYTES) return IMAGE_MESSAGES.tooBig
  return null
}

/** Makes a JPEG of a picture, no longer than `maxEdge` on its long side. It needs a browser: it decodes and draws. */
export async function resizeToJpeg(
  source: Blob,
  { maxEdge, quality }: { maxEdge: number; quality: number },
): Promise<{ blob: Blob; width: number; height: number }> {
  const picture = await createImageBitmap(source)
  try {
    const { width, height } = planResize(picture.width, picture.height, maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The browser has no canvas to draw on')
    // A JPEG has no transparency, and a transparent PNG would come out black.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(picture, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((made) => (made ? resolve(made) : reject(new Error('The picture could not be encoded'))), 'image/jpeg', quality)
    })
    return { blob, width, height }
  } finally {
    picture.close()
  }
}

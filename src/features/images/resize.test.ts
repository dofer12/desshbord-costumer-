import { describe, expect, it } from 'vitest'
import { pictureFile, stubImageApis } from '../../test/images'
import { IMAGE_MESSAGES, MAX_INPUT_BYTES, planResize, resizeToJpeg, validateImageFile } from './resize'

describe('planResize', () => {
  it('brings the long side of a landscape picture down to the limit, and keeps the ratio', () => {
    expect(planResize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(planResize(3000, 2000, 1600)).toEqual({ width: 1600, height: 1067 })
  })

  it('does the same for a portrait picture', () => {
    expect(planResize(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
    expect(planResize(2000, 3000, 1600)).toEqual({ width: 1067, height: 1600 })
  })

  it('makes a square picture a square', () => {
    expect(planResize(2000, 2000, 1600)).toEqual({ width: 1600, height: 1600 })
  })

  it('never enlarges: a picture that is not longer than the limit stays as it is', () => {
    expect(planResize(800, 600, 1600)).toEqual({ width: 800, height: 600 })
    expect(planResize(600, 800, 1600)).toEqual({ width: 600, height: 800 })
    expect(planResize(1600, 1000, 1600)).toEqual({ width: 1600, height: 1000 })
    expect(planResize(1601, 1000, 1600)).toEqual({ width: 1600, height: 999 })
  })

  it('makes the long side exactly the limit, whatever the rounding', () => {
    for (const [width, height] of [[4032, 3024], [3023, 4031], [5000, 3333], [3333, 5000]]) {
      const planned = planResize(width, height, 1600)
      expect(Math.max(planned.width, planned.height)).toBe(1600)
    }
  })

  it('never makes a side nothing, even for a very thin picture', () => {
    expect(planResize(10_000, 1, 1600)).toEqual({ width: 1600, height: 1 })
    expect(planResize(1, 10_000, 1600)).toEqual({ width: 1, height: 1600 })
  })

  it('makes the small picture for the thumbnail', () => {
    expect(planResize(1600, 1200, 320)).toEqual({ width: 320, height: 240 })
  })
})

describe('validateImageFile', () => {
  const mb = (n: number) => n * 1024 * 1024

  it('takes a normal photo', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: mb(3) })).toBeNull()
    expect(validateImageFile({ type: 'image/png', size: 40_000 })).toBeNull()
  })

  it('refuses what is not a picture, in Hebrew', () => {
    expect(validateImageFile({ type: 'application/pdf', size: mb(1) })).toBe('הקובץ אינו תמונה.')
    expect(validateImageFile({ type: 'text/plain', size: 10 })).toBe(IMAGE_MESSAGES.notAnImage)
    expect(validateImageFile({ type: '', size: 10 })).toBe(IMAGE_MESSAGES.notAnImage)
  })

  it('refuses a picture over 15 MB, and takes one of exactly 15 MB', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: mb(16) })).toBe('התמונה גדולה מדי. אפשר עד 15MB.')
    expect(validateImageFile({ type: 'image/jpeg', size: MAX_INPUT_BYTES + 1 })).toBe(IMAGE_MESSAGES.tooBig)
    expect(MAX_INPUT_BYTES).toBe(mb(15))
    expect(validateImageFile({ type: 'image/jpeg', size: MAX_INPUT_BYTES })).toBeNull()
  })

  it('says that it is not a picture before it says that it is too big', () => {
    expect(validateImageFile({ type: 'video/mp4', size: mb(500) })).toBe(IMAGE_MESSAGES.notAnImage)
  })
})

describe('resizeToJpeg', () => {
  it('makes a JPEG whose long side is the limit, and says how big it is', async () => {
    const images = stubImageApis()
    const result = await resizeToJpeg(pictureFile(images), { maxEdge: 1600, quality: 0.82 })

    expect(result).toMatchObject({ width: 1600, height: 1200 })
    expect(result.blob.type).toBe('image/jpeg')
    expect(images.encoded).toHaveLength(1)
    expect(images.encoded[0]).toMatchObject({ width: 1600, height: 1200, type: 'image/jpeg', quality: 0.82 })
    expect(images.encoded[0].blob).toBe(result.blob)
  })

  it('draws the whole picture at the new size', async () => {
    const images = stubImageApis({ width: 3000, height: 4000 })
    await resizeToJpeg(new Blob(['x']), { maxEdge: 320, quality: 0.7 })

    expect(images.drawImage).toHaveBeenCalledTimes(1)
    expect(images.drawImage).toHaveBeenCalledWith(expect.objectContaining({ width: 3000, height: 4000 }), 0, 0, 240, 320)
    expect(images.encoded[0]).toMatchObject({ width: 240, height: 320, quality: 0.7 })
  })

  it('does not enlarge a small picture', async () => {
    const images = stubImageApis({ width: 800, height: 600 })
    const result = await resizeToJpeg(new Blob(['x']), { maxEdge: 1600, quality: 0.82 })
    expect(result).toMatchObject({ width: 800, height: 600 })
    expect(images.encoded[0]).toMatchObject({ width: 800, height: 600 })
  })

  it('paints the canvas white before it draws, because a JPEG has no transparency', async () => {
    const images = stubImageApis()
    await resizeToJpeg(new Blob(['x']), { maxEdge: 1600, quality: 0.82 })

    expect(images.fillRect).toHaveBeenCalledWith(0, 0, 1600, 1200)
    expect(images.encoded[0].background).toBe('#ffffff')
    expect(images.fillRect.mock.invocationCallOrder[0]).toBeLessThan(images.drawImage.mock.invocationCallOrder[0])
  })

  it('smooths the picture when it makes it smaller', async () => {
    const images = stubImageApis()
    await resizeToJpeg(new Blob(['x']), { maxEdge: 320, quality: 0.82 })
    expect(images.settings).toMatchObject({ imageSmoothingEnabled: true, imageSmoothingQuality: 'high' })
  })

  it('makes the small picture from the picture that was made before it, since that is what it decodes', async () => {
    const images = stubImageApis()
    const full = await resizeToJpeg(pictureFile(images), { maxEdge: 1600, quality: 0.82 })
    const thumb = await resizeToJpeg(full.blob, { maxEdge: 320, quality: 0.82 })

    expect(thumb).toMatchObject({ width: 320, height: 240 })
    expect(images.decode).toHaveBeenLastCalledWith(full.blob)
  })

  it('lets go of the decoded picture when it is done', async () => {
    const images = stubImageApis()
    await resizeToJpeg(new Blob(['x']), { maxEdge: 1600, quality: 0.82 })
    expect(images.closed).toBe(1)
  })

  it('lets go of the decoded picture when the canvas fails too', async () => {
    const images = stubImageApis()
    images.failEncode()
    await expect(resizeToJpeg(new Blob(['x']), { maxEdge: 1600, quality: 0.82 })).rejects.toThrow()
    expect(images.closed).toBe(1)

    images.noContext()
    await expect(resizeToJpeg(new Blob(['x']), { maxEdge: 1600, quality: 0.82 })).rejects.toThrow()
    expect(images.closed).toBe(2)
  })

  it('fails when the picture cannot be decoded, and draws nothing', async () => {
    const images = stubImageApis()
    images.failDecode()
    await expect(resizeToJpeg(new Blob(['x']), { maxEdge: 1600, quality: 0.82 })).rejects.toThrow(/decoded/)
    expect(images.encoded).toHaveLength(0)
  })

  it('fails with a message when the canvas cannot encode', async () => {
    const images = stubImageApis()
    images.failEncode()
    await expect(resizeToJpeg(new Blob(['x']), { maxEdge: 1600, quality: 0.82 })).rejects.toThrow('The picture could not be encoded')
  })

  it('fails with a message when there is no canvas to draw on', async () => {
    const images = stubImageApis()
    images.noContext()
    await expect(resizeToJpeg(new Blob(['x']), { maxEdge: 1600, quality: 0.82 })).rejects.toThrow('canvas')
    expect(images.drawImage).not.toHaveBeenCalled()
  })
})

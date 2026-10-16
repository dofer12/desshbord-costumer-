import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { card, findCard, lastUpsert, openCard, task } from '../../test/cardHarness'
import type { FakeBackend } from '../../test/fakeBackend'
import { DANA, OWNER } from '../../test/fakeGateway'
import type { Profile } from '../auth/types'
import { networkError, refusal } from '../../test/fakeTasksGateways'
import { pictureFile, stubImageApis } from '../../test/images'
import { SYNC_MESSAGES } from '../tasks/errors'
import type { Attachment } from '../tasks/gateways'
import type { Task } from '../tasks/model'
import { IMAGE_MESSAGES } from './resize'

const urlOf = (path: string) => `https://files.example/${path}?token=memory`

function attachment(id: string, patch: Partial<Attachment> = {}): Attachment {
  return {
    id,
    task_id: 'a',
    storage_path: `a/${id}.jpg`,
    thumb_path: `a/${id}_t.jpg`,
    kind: 'image',
    width: 1600,
    height: 1200,
    bytes: 120_000,
    uploaded_by: DANA.id,
    created_at: '2026-10-10T08:00:00.000Z',
    ...patch,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

interface Options {
  task?: Partial<Task>
  backend?: (fake: FakeBackend) => void
  as?: Profile
}

/** The card of the saved task "a", over a pretend server that holds these pictures, with the picture functions of a browser in place. */
function openWith(pictures: Attachment[] = [], options: Options = {}) {
  const images = stubImageApis()
  const opened = openCard('/tasks/a', [task('a', options.task)], {
    as: options.as,
    backend: (fake) => {
      fake.attachments.items.push(...pictures)
      options.backend?.(fake)
    },
  })
  const gateway = opened.backend.backend.attachments
  return { ...opened, images, gateway, store: opened.backend.attachments }
}

/** The card itself, which stays the first of the dialogs while a picture is open over it. */
const outer = () => within(screen.getAllByRole('dialog')[0])
const region = () => outer().getByRole('region', { name: 'תמונות' })
const thumbs = () => within(region()).queryAllByRole('button', { name: /^תמונה \d+ מתוך \d+/ })
const gallery = () => card().getByLabelText('מהגלריה') as HTMLInputElement
const camera = () => card().getByLabelText('צלם') as HTMLInputElement
const pictureIn = (button: HTMLElement) => button.querySelector('img')
const viewer = () => within(screen.getByRole('dialog', { name: /^תמונה \d+ מתוך \d+$/ }))
const viewerBackdrop = () => screen.getByRole('dialog', { name: /^תמונה \d+ מתוך \d+$/ }).parentElement as HTMLElement

/** Waits until the list of pictures is there, with a small picture shown for each. */
async function loaded(count: number) {
  await findCard()
  if (count === 0) {
    await screen.findByText('אין תמונות עדיין.')
    return
  }
  await waitFor(() => expect(thumbs()).toHaveLength(count))
  await waitFor(() => thumbs().forEach((button) => expect(pictureIn(button)).toHaveAttribute('src')))
}

function paste(target: Element, files: File[], types: string[] = ['Files']) {
  return fireEvent.paste(target, { clipboardData: { files, types, items: [], getData: () => '' } })
}

const pdf = () => new File(['%PDF'], 'report.pdf', { type: 'application/pdf' })

describe('the pictures part of the card', () => {
  it('says on a new task that pictures can be added once it is saved, and offers no buttons', async () => {
    openCard('/tasks/new')
    await findCard()
    expect(within(region()).getByText('אפשר להוסיף תמונות אחרי שהמשימה נשמרת.')).toBeInTheDocument()
    expect(card().queryByLabelText('מהגלריה')).not.toBeInTheDocument()
    expect(card().queryByLabelText('צלם')).not.toBeInTheDocument()
  })

  it('does not ask the server for the pictures of a new task, which has none', async () => {
    const list = vi.fn()
    openCard('/tasks/new', [], {
      backend: (fake) => {
        fake.backend.attachments.list = list
      },
    })
    await findCard()
    await act(async () => undefined)
    expect(list).not.toHaveBeenCalled()
  })

  it('offers the camera and the gallery on a saved task, and says that a picture can be pasted', async () => {
    openWith()
    await loaded(0)
    expect(camera()).toHaveAttribute('type', 'file')
    expect(camera()).toHaveAttribute('accept', 'image/*')
    expect(camera()).toHaveAttribute('capture', 'environment')
    expect(camera()).not.toHaveAttribute('multiple')
    expect(gallery()).toHaveAttribute('accept', 'image/*')
    expect(gallery()).toHaveAttribute('multiple')
    expect(gallery()).not.toHaveAttribute('capture')
    expect(within(region()).getByText('אפשר גם להדביק תמונה (Ctrl+V).')).toBeInTheDocument()
  })

  it('says that it is loading, and offers nothing until the list is there', async () => {
    const list = deferred<Attachment[]>()
    openWith([], {
      backend: (fake) => {
        vi.spyOn(fake.backend.attachments, 'list').mockReturnValueOnce(list.promise)
      },
    })
    await findCard()
    expect(within(region()).getByText('טוען תמונות…')).toBeInTheDocument()
    expect(gallery()).toBeDisabled()
    expect(camera()).toBeDisabled()
    expect(gallery().closest('label')).toHaveClass('disabled')
    expect(camera().closest('label')).toHaveClass('disabled')

    list.resolve([])
    expect(await screen.findByText('אין תמונות עדיין.')).toBeInTheDocument()
    expect(screen.queryByText('טוען תמונות…')).not.toBeInTheDocument()
    expect(gallery()).toBeEnabled()
    expect(gallery().closest('label')).not.toHaveClass('disabled')
  })

  it('says why the list could not be loaded, and tries again when asked', async () => {
    const { user, gateway } = openWith([attachment('p1')], {
      backend: (fake) => {
        fake.attachments.failNext(networkError())
      },
    })
    await findCard()
    expect(await within(region()).findByText(SYNC_MESSAGES.unreachable)).toHaveAttribute('role', 'alert')
    expect(gallery()).toBeDisabled()

    const again = deferred<Attachment[]>()
    const original = gateway.list
    vi.spyOn(gateway, 'list').mockReturnValueOnce(again.promise)
    await user.click(within(region()).getByRole('button', { name: 'נסו שוב' }))
    expect(within(region()).getByText('טוען תמונות…')).toBeInTheDocument()
    expect(screen.queryByText(SYNC_MESSAGES.unreachable)).not.toBeInTheDocument()

    again.resolve(await original('a'))
    await waitFor(() => expect(thumbs()).toHaveLength(1))
    expect(screen.queryByText('טוען תמונות…')).not.toBeInTheDocument()
    expect(gallery()).toBeEnabled()
  })

  it('shows a small picture for each, in order, with the address that the server signed for the small file', async () => {
    openWith([attachment('p1'), attachment('p2'), attachment('p3')])
    await loaded(3)
    expect(thumbs().map((button) => button.getAttribute('aria-label'))).toEqual(['תמונה 1 מתוך 3', 'תמונה 2 מתוך 3', 'תמונה 3 מתוך 3'])
    expect(within(region()).getByRole('list', { name: 'תמונות המשימה' })).toBeInTheDocument()
    await waitFor(() => expect(thumbs().map((button) => pictureIn(button)?.getAttribute('src'))).toEqual([urlOf('a/p1_t.jpg'), urlOf('a/p2_t.jpg'), urlOf('a/p3_t.jpg')]))
    expect(screen.queryByText('אין תמונות עדיין.')).not.toBeInTheDocument()
  })

  it('asks for the address of each small picture once, however often the card is drawn again', async () => {
    const { user, gateway } = openWith([attachment('p1'), attachment('p2')])
    const signed = vi.spyOn(gateway, 'signedUrl')
    await loaded(2)
    await waitFor(() => expect(pictureIn(thumbs()[1])).toHaveAttribute('src'))
    await user.type(card().getByLabelText('הערות'), 'abc')
    expect(signed.mock.calls.map(([path]) => path)).toEqual(['a/p1_t.jpg', 'a/p2_t.jpg'])
  })

  it('says that a picture is not available when it cannot be shown', async () => {
    openWith([attachment('p1')])
    await loaded(1)
    await waitFor(() => expect(pictureIn(thumbs()[0])).toHaveAttribute('src'))
    fireEvent.error(pictureIn(thumbs()[0])!)
    expect(await within(thumbs()[0]).findByText('התמונה לא זמינה')).toBeInTheDocument()
    expect(pictureIn(thumbs()[0])).toBeNull()
  })

  it('says that a picture is not available when the server will not sign its address', async () => {
    openWith([attachment('p1')], {
      backend: (fake) => {
        vi.spyOn(fake.backend.attachments, 'signedUrl').mockRejectedValue(networkError())
      },
    })
    await waitFor(() => expect(thumbs()).toHaveLength(1))
    expect(await within(thumbs()[0]).findByText('התמונה לא זמינה')).toBeInTheDocument()
    expect(thumbs()[0].querySelector('.picture-wait')).toBeNull()
  })

  it('holds a place for a small picture until its address comes', async () => {
    const address = deferred<string>()
    openWith([attachment('p1')], {
      backend: (fake) => {
        vi.spyOn(fake.backend.attachments, 'signedUrl').mockReturnValueOnce(address.promise)
      },
    })
    await waitFor(() => expect(thumbs()).toHaveLength(1))
    expect(pictureIn(thumbs()[0])).toBeNull()
    expect(thumbs()[0].querySelector('.picture-wait')).not.toBeNull()

    address.resolve(urlOf('a/p1_t.jpg'))
    await waitFor(() => expect(pictureIn(thumbs()[0])).toHaveAttribute('src', urlOf('a/p1_t.jpg')))
    expect(thumbs()[0].querySelector('.picture-wait')).toBeNull()
  })
})

describe('adding pictures', () => {
  it('resizes a picture from the gallery, uploads both sizes, and shows it', async () => {
    const { user, images, gateway } = openWith()
    const add = vi.spyOn(gateway, 'add')
    await loaded(0)
    const file = pictureFile(images)
    await user.upload(gallery(), file)

    await waitFor(() => expect(thumbs()).toHaveLength(1))
    // The same objects, not objects that look alike: a Blob has nothing to compare.
    expect(images.decode.mock.calls[0][0]).toBe(file)
    expect(images.decode.mock.calls[1][0]).toBe(images.encoded[0].blob)
    expect(images.encoded.map(({ width, height, quality, type }) => ({ width, height, quality, type }))).toEqual([
      { width: 1600, height: 1200, quality: 0.82, type: 'image/jpeg' },
      { width: 320, height: 240, quality: 0.82, type: 'image/jpeg' },
    ])
    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith('a', { full: expect.any(Blob), thumb: expect.any(Blob), kind: 'image', width: 1600, height: 1200 })
    expect(add.mock.calls[0][1].full).toBe(images.encoded[0].blob)
    expect(add.mock.calls[0][1].thumb).toBe(images.encoded[1].blob)
    await waitFor(() => expect(pictureIn(thumbs()[0])).toHaveAttribute('src', urlOf('a/attachment-1_t.jpg')))
    expect(screen.queryByText('אין תמונות עדיין.')).not.toBeInTheDocument()
  })

  it('adds a picture from the camera the same way', async () => {
    const { user, images, store } = openWith()
    await loaded(0)
    await user.upload(camera(), pictureFile(images, 'camera.jpg', { width: 3000, height: 4000 }))
    await waitFor(() => expect(thumbs()).toHaveLength(1))
    expect(store.items).toMatchObject([{ task_id: 'a', kind: 'image', width: 1200, height: 1600 }])
  })

  it('adds several pictures one after the other, in the order they were picked', async () => {
    const { user, images, store } = openWith()
    await loaded(0)
    await user.upload(gallery(), [
      pictureFile(images, 'one.jpg', { width: 4000, height: 3000 }),
      pictureFile(images, 'two.jpg', { width: 3000, height: 4000 }),
      pictureFile(images, 'three.jpg', { width: 2000, height: 2000 }),
    ])
    await waitFor(() => expect(thumbs()).toHaveLength(3))
    expect(images.encoded.map((made) => `${made.width}x${made.height}`)).toEqual(['1600x1200', '320x240', '1200x1600', '240x320', '1600x1600', '320x320'])
    expect(store.items.map((item) => `${item.width}x${item.height}`)).toEqual(['1600x1200', '1200x1600', '1600x1600'])
    await waitFor(() =>
      expect(thumbs().map((button) => pictureIn(button)?.getAttribute('src'))).toEqual([
        urlOf('a/attachment-1_t.jpg'),
        urlOf('a/attachment-2_t.jpg'),
        urlOf('a/attachment-3_t.jpg'),
      ]),
    )
  })

  it('says that it is uploading while it works, and how many pictures are waiting', async () => {
    const { user, images, gateway } = openWith()
    const first = deferred<void>()
    const original = gateway.add
    vi.spyOn(gateway, 'add').mockImplementationOnce(async (...args) => {
      await first.promise
      return original(...args)
    })
    await loaded(0)
    await user.upload(gallery(), [pictureFile(images, 'one.jpg'), pictureFile(images, 'two.jpg')])
    expect(await within(region()).findByText('מעלה 2 תמונות…')).toHaveAttribute('role', 'status')

    first.resolve()
    await waitFor(() => expect(thumbs()).toHaveLength(2))
    expect(within(region()).queryByRole('status')).not.toBeInTheDocument()
  })

  it('says it in the singular when one picture is uploading', async () => {
    const { user, images, gateway } = openWith()
    const gate = deferred<void>()
    const original = gateway.add
    vi.spyOn(gateway, 'add').mockImplementationOnce(async (...args) => {
      await gate.promise
      return original(...args)
    })
    await loaded(0)
    await user.upload(gallery(), pictureFile(images))
    expect(await within(region()).findByText('מעלה תמונה…')).toHaveAttribute('role', 'status')
    gate.resolve()
    await waitFor(() => expect(thumbs()).toHaveLength(1))
  })

  it('lets the same file be picked again straight away', async () => {
    const { user, images } = openWith()
    await loaded(0)
    const file = pictureFile(images)
    await user.upload(gallery(), file)
    await waitFor(() => expect(thumbs()).toHaveLength(1))
    await user.upload(gallery(), file)
    await waitFor(() => expect(thumbs()).toHaveLength(2))
  })

  it('refuses a file that is not a picture, says so, and does nothing with it', async () => {
    const { images, gateway } = openWith()
    const add = vi.spyOn(gateway, 'add')
    await loaded(0)
    fireEvent.change(gallery(), { target: { files: [pdf()] } })

    expect(await within(region()).findByText(IMAGE_MESSAGES.notAnImage)).toBeInTheDocument()
    expect(within(region()).getByRole('alert')).toHaveTextContent('הקובץ אינו תמונה.')
    expect(images.decode).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
    expect(thumbs()).toHaveLength(0)
  })

  it('refuses a picture over 15 MB', async () => {
    const { images, gateway } = openWith()
    const add = vi.spyOn(gateway, 'add')
    await loaded(0)
    const big = pictureFile(images, 'big.jpg')
    Object.defineProperty(big, 'size', { value: 16 * 1024 * 1024 })
    fireEvent.change(gallery(), { target: { files: [big] } })

    expect(await within(region()).findByText('התמונה גדולה מדי. אפשר עד 15MB.')).toBeInTheDocument()
    expect(add).not.toHaveBeenCalled()
  })

  it('takes the good files of a batch, and names the one it refused', async () => {
    const { images, store } = openWith()
    await loaded(0)
    fireEvent.change(gallery(), { target: { files: [pdf(), pictureFile(images, 'ok.jpg')] } })

    await waitFor(() => expect(thumbs()).toHaveLength(1))
    expect(within(region()).getByRole('alert')).toHaveTextContent('report.pdf: הקובץ אינו תמונה.')
    expect(store.items).toHaveLength(1)
  })

  it('says that a damaged picture cannot be read, and uploads nothing', async () => {
    const { user, images, gateway } = openWith()
    const add = vi.spyOn(gateway, 'add')
    await loaded(0)
    images.failDecode()
    await user.upload(gallery(), pictureFile(images))

    expect(await within(region()).findByText(IMAGE_MESSAGES.unreadable)).toHaveAttribute('role', 'alert')
    expect(add).not.toHaveBeenCalled()
    expect(thumbs()).toHaveLength(0)
    expect(within(region()).queryByRole('status')).not.toBeInTheDocument()
  })

  it('says that saving failed when the server refuses, leaves the pictures as they were, and works again afterwards', async () => {
    const { user, images, store } = openWith([attachment('p1')])
    await loaded(1)
    store.failNext(refusal(400))
    await user.upload(gallery(), pictureFile(images, 'one.jpg'))

    expect(await within(region()).findByText('שמירת התמונה נכשלה. נסו שוב בעוד רגע.')).toHaveAttribute('role', 'alert')
    expect(thumbs()).toHaveLength(1)
    expect(within(region()).queryByRole('status')).not.toBeInTheDocument()

    await user.upload(gallery(), pictureFile(images, 'two.jpg'))
    await waitFor(() => expect(thumbs()).toHaveLength(2))
    expect(within(region()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says that there is no connection when the upload cannot reach the server', async () => {
    const { user, images, store } = openWith()
    await loaded(0)
    store.failNext(networkError())
    await user.upload(gallery(), pictureFile(images))
    expect(await within(region()).findByText(SYNC_MESSAGES.unreachable)).toBeInTheDocument()
    expect(thumbs()).toHaveLength(0)
  })

  it('says that there is no permission when the server will not allow it', async () => {
    const { user, images, store } = openWith()
    await loaded(0)
    store.failNext(refusal(403))
    await user.upload(gallery(), pictureFile(images))
    expect(await within(region()).findByText('אין הרשאה להוסיף תמונה.')).toBeInTheDocument()
  })

  it('says that there is no permission when the login has ended, too', async () => {
    const { user, images, store } = openWith()
    await loaded(0)
    store.failNext(refusal(401))
    await user.upload(gallery(), pictureFile(images))
    expect(await within(region()).findByText('אין הרשאה להוסיף תמונה.')).toBeInTheDocument()
  })

  it('goes on with the next picture when one fails, and names the one that failed', async () => {
    const { user, images, store } = openWith()
    await loaded(0)
    store.failNext(refusal(400))
    await user.upload(gallery(), [pictureFile(images, 'one.jpg'), pictureFile(images, 'two.jpg')])

    await waitFor(() => expect(thumbs()).toHaveLength(1))
    expect(within(region()).getByRole('alert')).toHaveTextContent('one.jpg: שמירת התמונה נכשלה. נסו שוב בעוד רגע.')
    expect(store.items).toHaveLength(1)
  })

  it('names the damaged one when several were picked', async () => {
    const { user, images } = openWith()
    await loaded(0)
    const damaged = pictureFile(images, 'damaged.jpg')
    images.decode.mockRejectedValueOnce(new DOMException('no', 'InvalidStateError'))
    await user.upload(gallery(), [damaged, pictureFile(images, 'fine.jpg')])
    await waitFor(() => expect(thumbs()).toHaveLength(1))
    expect(within(region()).getByRole('alert')).toHaveTextContent(`damaged.jpg: ${IMAGE_MESSAGES.unreadable}`)
  })

  it('takes away the old messages when new files are picked', async () => {
    const { user, images } = openWith()
    await loaded(0)
    await userEvent.setup({ applyAccept: false }).upload(gallery(), pdf())
    expect(await within(region()).findByRole('alert')).toBeInTheDocument()
    await user.upload(gallery(), pictureFile(images))
    await waitFor(() => expect(thumbs()).toHaveLength(1))
    expect(within(region()).queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('a choice that picks nothing', () => {
  it('leaves the messages alone when the choice was cancelled', async () => {
    openWith()
    await loaded(0)
    fireEvent.change(gallery(), { target: { files: [pdf()] } })
    expect(await within(region()).findByRole('alert')).toBeInTheDocument()
    fireEvent.change(gallery(), { target: { files: [] } })
    expect(within(region()).getByRole('alert')).toHaveTextContent('הקובץ אינו תמונה.')
  })
})

describe('pasting a picture', () => {
  it('adds a picture that is pasted, as a screenshot', async () => {
    const { images, gateway, store } = openWith()
    const add = vi.spyOn(gateway, 'add')
    await loaded(0)
    const prevented = !paste(document.body, [pictureFile(images, 'image.png', { width: 1000, height: 500 }, 'image/png')])

    await waitFor(() => expect(thumbs()).toHaveLength(1))
    expect(prevented).toBe(true)
    expect(add).toHaveBeenCalledWith('a', expect.objectContaining({ kind: 'screenshot', width: 1000, height: 500 }))
    expect(store.items).toHaveLength(1)
  })

  it('adds each of several pictures that are pasted together', async () => {
    const { images } = openWith()
    await loaded(0)
    paste(card().getByLabelText('הערות'), [pictureFile(images, 'one.png', undefined, 'image/png'), pictureFile(images, 'two.png', undefined, 'image/png')])
    await waitFor(() => expect(thumbs()).toHaveLength(2))
  })

  it('ignores a paste of text, and lets it go where it was going', async () => {
    const { gateway } = openWith()
    const add = vi.spyOn(gateway, 'add')
    await loaded(0)
    const notes = card().getByLabelText('הערות')
    const allowed = paste(notes, [], ['text/plain'])
    expect(allowed).toBe(true)
    expect(add).not.toHaveBeenCalled()
    expect(within(region()).queryByRole('status')).not.toBeInTheDocument()
  })

  it('ignores files that are not pictures, without a word', async () => {
    const { gateway } = openWith()
    const add = vi.spyOn(gateway, 'add')
    await loaded(0)
    const allowed = paste(document.body, [pdf()])
    expect(allowed).toBe(true)
    expect(add).not.toHaveBeenCalled()
    expect(within(region()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('leaves the text alone when the clipboard holds a picture too and the paste goes into a field, as it does from a spreadsheet', async () => {
    const { images, gateway } = openWith()
    const add = vi.spyOn(gateway, 'add')
    await loaded(0)
    const allowed = paste(card().getByLabelText('הערות'), [pictureFile(images, 'cells.png', undefined, 'image/png')], ['text/plain', 'text/html', 'Files'])
    expect(allowed).toBe(true)
    expect(add).not.toHaveBeenCalled()
  })

  it('takes the picture when it goes into a field and there is no text with it, as a screenshot does', async () => {
    const { images } = openWith()
    await loaded(0)
    const allowed = paste(card().getByLabelText('הערות'), [pictureFile(images, 'shot.png', undefined, 'image/png')], ['Files'])
    expect(allowed).toBe(false)
    await waitFor(() => expect(thumbs()).toHaveLength(1))
  })

  it('takes a picture that comes with text when it is not pasted into a field', async () => {
    const { images } = openWith()
    await loaded(0)
    paste(document.body, [pictureFile(images, 'both.png', undefined, 'image/png')], ['text/plain', 'Files'])
    await waitFor(() => expect(thumbs()).toHaveLength(1))
  })

  it('refuses a pasted picture that is too big, like any other', async () => {
    const { images, gateway } = openWith()
    const add = vi.spyOn(gateway, 'add')
    await loaded(0)
    const big = pictureFile(images, 'big.png', undefined, 'image/png')
    Object.defineProperty(big, 'size', { value: 20 * 1024 * 1024 })
    paste(document.body, [big])
    expect(await within(region()).findByText(IMAGE_MESSAGES.tooBig)).toBeInTheDocument()
    expect(add).not.toHaveBeenCalled()
  })

  it('does nothing with a paste before the list has loaded', async () => {
    const list = deferred<Attachment[]>()
    const { images, gateway } = openWith([], {
      backend: (fake) => {
        vi.spyOn(fake.backend.attachments, 'list').mockReturnValueOnce(list.promise)
      },
    })
    const add = vi.spyOn(gateway, 'add')
    await findCard()
    const allowed = paste(document.body, [pictureFile(images, 'early.png', undefined, 'image/png')])
    expect(allowed).toBe(true)
    expect(add).not.toHaveBeenCalled()
    list.resolve([])
    await screen.findByText('אין תמונות עדיין.')
  })

  it('stops listening for pastes when the card is closed', async () => {
    const { user, images, gateway } = openWith()
    const add = vi.spyOn(gateway, 'add')
    await loaded(0)
    await user.click(card().getByRole('button', { name: 'סגירה' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const allowed = paste(document.body, [pictureFile(images, 'late.png', undefined, 'image/png')])
    expect(allowed).toBe(true)
    expect(add).not.toHaveBeenCalled()
  })
})

describe('looking at a picture', () => {
  it('opens it in a window of its own over the card, with the big file', async () => {
    const { user } = openWith([attachment('p1'), attachment('p2')])
    await loaded(2)
    await user.click(thumbs()[1])

    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    expect(screen.getByRole('dialog', { name: 'תמונה 2 מתוך 2' })).toBeInTheDocument()
    expect(viewer().getByRole('button', { name: 'סגירת התמונה' })).toHaveFocus()
    await waitFor(() => expect(viewer().getByRole('img', { name: 'התמונה המצורפת' })).toHaveAttribute('src', urlOf('a/p2.jpg')))
    expect(viewer().getByRole('img', { name: 'התמונה המצורפת' })).toHaveClass('viewer-image')
  })

  it('closes with its button and gives the focus back to the small picture', async () => {
    const { user } = openWith([attachment('p1'), attachment('p2')])
    await loaded(2)
    await user.click(thumbs()[1])
    await user.click(viewer().getByRole('button', { name: 'סגירת התמונה' }))

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(thumbs()[1]).toHaveFocus()
  })

  it('closes with Escape and leaves the card open', async () => {
    const { user } = openWith([attachment('p1')])
    await loaded(1)
    await user.click(thumbs()[0])
    await user.keyboard('{Escape}')

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.queryByText('יש שינויים שלא נשמרו.')).not.toBeInTheDocument()
  })

  it('closes with a click on the dark area around it', async () => {
    const { user } = openWith([attachment('p1')])
    await loaded(1)
    await user.click(thumbs()[0])
    await user.click(viewerBackdrop())
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('keeps the Tab key inside it', async () => {
    const { user } = openWith([attachment('p1')])
    await loaded(1)
    await user.click(thumbs()[0])
    const dialog = screen.getByRole('dialog', { name: 'תמונה 1 מתוך 1' })
    for (let i = 0; i < 6; i++) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('asks before it deletes, and keeps the picture when the answer is no, with the focus back on the button', async () => {
    const { user, store } = openWith([attachment('p1')])
    await loaded(1)
    await user.click(thumbs()[0])
    await user.click(viewer().getByRole('button', { name: 'מחיקת התמונה' }))

    expect(viewer().getByText('למחוק את התמונה?')).toBeInTheDocument()
    expect(viewer().getByRole('alert')).toHaveTextContent('למחוק את התמונה?')
    expect(viewer().getByRole('button', { name: 'לא, להשאיר' })).toHaveFocus()
    expect(store.items).toHaveLength(1)

    await user.click(viewer().getByRole('button', { name: 'לא, להשאיר' }))
    expect(viewer().queryByText('למחוק את התמונה?')).not.toBeInTheDocument()
    expect(viewer().getByRole('button', { name: 'מחיקת התמונה' })).toHaveFocus()
    expect(store.items).toHaveLength(1)
  })

  it('goes back from the question to the picture with Escape, and does not close the window', async () => {
    const { user } = openWith([attachment('p1')])
    await loaded(1)
    await user.click(thumbs()[0])
    await user.click(viewer().getByRole('button', { name: 'מחיקת התמונה' }))
    await user.keyboard('{Escape}')

    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    expect(viewer().queryByText('למחוק את התמונה?')).not.toBeInTheDocument()
  })

  it('holds still while the server deletes: the answers are off and Escape does nothing, until it answers', async () => {
    const { user, gateway, store } = openWith([attachment('p1')])
    const gate = deferred<void>()
    const original = gateway.remove
    vi.spyOn(gateway, 'remove').mockImplementationOnce(async (item) => {
      await gate.promise
      return original(item)
    })
    await loaded(1)
    await user.click(thumbs()[0])
    await user.click(viewer().getByRole('button', { name: 'מחיקת התמונה' }))
    await user.click(viewer().getByRole('button', { name: 'כן, למחוק' }))

    expect(viewer().getByRole('button', { name: 'כן, למחוק' })).toBeDisabled()
    expect(viewer().getByRole('button', { name: 'לא, להשאיר' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'תמונה 1 מתוך 1' }), { key: 'Escape' })
    expect(viewer().getByText('למחוק את התמונה?')).toBeInTheDocument()

    gate.resolve()
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
    expect(store.items).toHaveLength(0)
  })

  it('deletes the picture when the answer is yes: it goes from the server and from the grid, and the window closes', async () => {
    const { user, store } = openWith([attachment('p1'), attachment('p2')])
    await loaded(2)
    await user.click(thumbs()[0])
    await user.click(viewer().getByRole('button', { name: 'מחיקת התמונה' }))
    await user.click(viewer().getByRole('button', { name: 'כן, למחוק' }))

    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
    expect(store.items.map((item) => item.id)).toEqual(['p2'])
    expect(store.removedFiles).toEqual(['a/p1.jpg', 'a/p1_t.jpg'])
    expect(thumbs().map((button) => button.getAttribute('aria-label'))).toEqual(['תמונה 1 מתוך 1'])
  })

  it('puts the focus on a picture that is left, or on the first button when none is, once a picture is deleted, so that it is not lost', async () => {
    const { user } = openWith([attachment('p1'), attachment('p2')])
    await loaded(2)
    await user.click(thumbs()[0])
    await user.click(viewer().getByRole('button', { name: 'מחיקת התמונה' }))
    await user.click(viewer().getByRole('button', { name: 'כן, למחוק' }))
    await waitFor(() => expect(thumbs()).toHaveLength(1))
    expect(thumbs()[0]).toHaveFocus()

    await user.click(thumbs()[0])
    await user.click(viewer().getByRole('button', { name: 'מחיקת התמונה' }))
    await user.click(viewer().getByRole('button', { name: 'כן, למחוק' }))
    await screen.findByText('אין תמונות עדיין.')
    expect(camera()).toHaveFocus()
  })

  it('says that there is no permission when the server will not delete, and keeps the picture', async () => {
    const { user, store } = openWith([attachment('p1')])
    await loaded(1)
    await user.click(thumbs()[0])
    await user.click(viewer().getByRole('button', { name: 'מחיקת התמונה' }))
    store.failNext(refusal(403))
    await user.click(viewer().getByRole('button', { name: 'כן, למחוק' }))

    expect(await viewer().findByText('אין הרשאה למחוק את התמונה. מוחק רק מי שהעלה אותה, או מנהל.')).toHaveAttribute('role', 'alert')
    expect(viewer().queryByText('למחוק את התמונה?')).not.toBeInTheDocument()
    expect(viewer().getByRole('button', { name: 'מחיקת התמונה' })).toHaveFocus()
    expect(store.items).toHaveLength(1)
    expect(thumbs()).toHaveLength(1)
    expect(screen.getAllByRole('dialog')).toHaveLength(2)

    await user.click(viewer().getByRole('button', { name: 'מחיקת התמונה' }))
    expect(viewer().queryByText('אין הרשאה למחוק את התמונה. מוחק רק מי שהעלה אותה, או מנהל.')).not.toBeInTheDocument()
  })

  it('says that there is no connection when deleting cannot reach the server', async () => {
    const { user, store } = openWith([attachment('p1')])
    await loaded(1)
    await user.click(thumbs()[0])
    await user.click(viewer().getByRole('button', { name: 'מחיקת התמונה' }))
    store.failNext(networkError())
    await user.click(viewer().getByRole('button', { name: 'כן, למחוק' }))
    expect(await viewer().findByText(SYNC_MESSAGES.unreachable)).toBeInTheDocument()
    expect(store.items).toHaveLength(1)
  })

  it('says that deleting failed for any other reason too', async () => {
    const { user, store } = openWith([attachment('p1')])
    await loaded(1)
    await user.click(thumbs()[0])
    await user.click(viewer().getByRole('button', { name: 'מחיקת התמונה' }))
    store.failNext(refusal(400))
    await user.click(viewer().getByRole('button', { name: 'כן, למחוק' }))
    expect(await viewer().findByText('מחיקת התמונה נכשלה. נסו שוב בעוד רגע.')).toBeInTheDocument()

    await user.click(viewer().getByRole('button', { name: 'מחיקת התמונה' }))
    await user.click(viewer().getByRole('button', { name: 'כן, למחוק' }))
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
    expect(store.items).toHaveLength(0)
  })

  it('offers no delete for a picture that somebody else uploaded, since the server would refuse it', async () => {
    const { user } = openWith([attachment('p1', { uploaded_by: OWNER.id })])
    await loaded(1)
    await user.click(thumbs()[0])
    expect(viewer().getByRole('button', { name: 'סגירת התמונה' })).toBeInTheDocument()
    expect(viewer().queryByRole('button', { name: 'מחיקת התמונה' })).not.toBeInTheDocument()
  })

  it('offers no delete to an employee for a picture whose uploader is gone', async () => {
    const { user } = openWith([attachment('p1', { uploaded_by: null })])
    await loaded(1)
    await user.click(thumbs()[0])
    expect(viewer().queryByRole('button', { name: 'מחיקת התמונה' })).not.toBeInTheDocument()
  })

  it('offers an administrator the delete of any picture, whoever uploaded it', async () => {
    const { user } = openWith([attachment('p1', { uploaded_by: DANA.id }), attachment('p2', { uploaded_by: null })], { as: OWNER })
    await loaded(2)
    await user.click(thumbs()[0])
    expect(viewer().getByRole('button', { name: 'מחיקת התמונה' })).toBeInTheDocument()
    await user.click(viewer().getByRole('button', { name: 'סגירת התמונה' }))
    await user.click(thumbs()[1])
    expect(viewer().getByRole('button', { name: 'מחיקת התמונה' })).toBeInTheDocument()
  })

  it('does not offer a product picture for a task that is not a pickup', async () => {
    const { user } = openWith([attachment('p1')])
    await loaded(1)
    await user.click(thumbs()[0])
    expect(viewer().queryByRole('button', { name: 'קבע כתמונת מוצר' })).not.toBeInTheDocument()
  })
})

describe('the picture of a pickup', () => {
  const pickup: Partial<Task> = { kind: 'pickup', product_name: 'מקדחה', product_sku: 'DR-1' }

  it('lets one of the pictures be set as the picture of the product, through the store, and says so after', async () => {
    const { user, backend } = openWith([attachment('p1'), attachment('p2')], { task: pickup })
    await loaded(2)
    await user.click(thumbs()[1])
    const button = viewer().getByRole('button', { name: 'קבע כתמונת מוצר' })
    expect(viewer().queryByText('זו תמונת המוצר')).not.toBeInTheDocument()
    await user.click(button)

    await waitFor(() => expect(lastUpsert(backend)?.patch).toEqual({ thumb_attachment_id: 'p2' }))
    expect(await viewer().findByText('זו תמונת המוצר')).toHaveAttribute('role', 'status')
    expect(viewer().getByRole('button', { name: 'הסר כתמונת מוצר' })).toBe(button)
    expect(button).toHaveFocus()
  })

  it('takes the picture away from the product again with the same button', async () => {
    const { user, backend } = openWith([attachment('p1')], { task: { ...pickup, thumb_attachment_id: 'p1' } })
    await loaded(1)
    await user.click(thumbs()[0])
    expect(viewer().getByText('זו תמונת המוצר')).toBeInTheDocument()
    await user.click(viewer().getByRole('button', { name: 'הסר כתמונת מוצר' }))

    await waitFor(() => expect(lastUpsert(backend)?.patch).toEqual({ thumb_attachment_id: null }))
    await waitFor(() => expect(viewer().queryByText('זו תמונת המוצר')).not.toBeInTheDocument())
    expect(viewer().getByRole('button', { name: 'קבע כתמונת מוצר' })).toHaveFocus()
  })

  it('knows which picture is the product picture, and offers to set another one', async () => {
    const { user } = openWith([attachment('p1'), attachment('p2')], { task: { ...pickup, thumb_attachment_id: 'p2' } })
    await loaded(2)
    await user.click(thumbs()[0])
    expect(viewer().queryByText('זו תמונת המוצר')).not.toBeInTheDocument()
    expect(viewer().getByRole('button', { name: 'קבע כתמונת מוצר' })).toBeInTheDocument()
  })

  it('marks the product picture in the grid, by name too', async () => {
    openWith([attachment('p1'), attachment('p2')], { task: { ...pickup, thumb_attachment_id: 'p2' } })
    await loaded(2)
    expect(thumbs()[0]).toHaveAttribute('aria-label', 'תמונה 1 מתוך 2')
    expect(thumbs()[1]).toHaveAttribute('aria-label', 'תמונה 2 מתוך 2, תמונת מוצר')
    expect(within(thumbs()[1]).getByText('תמונת מוצר')).toBeInTheDocument()
    expect(within(thumbs()[0]).queryByText('תמונת מוצר')).not.toBeInTheDocument()
  })

  it('shows the picture of the product among the details of the pickup', async () => {
    openWith([attachment('p1'), attachment('p2')], { task: { ...pickup, thumb_attachment_id: 'p2' } })
    await loaded(2)
    const product = await card().findByRole('img', { name: 'תמונת המוצר' })
    await waitFor(() => expect(product).toHaveAttribute('src', urlOf('a/p2_t.jpg')))
    expect(product).toHaveClass('product-thumb')
  })

  it('shows it as soon as it is set', async () => {
    const { user } = openWith([attachment('p1')], { task: pickup })
    await loaded(1)
    expect(card().queryByRole('img', { name: 'תמונת המוצר' })).not.toBeInTheDocument()
    await user.click(thumbs()[0])
    await user.click(viewer().getByRole('button', { name: 'קבע כתמונת מוצר' }))
    await user.click(viewer().getByRole('button', { name: 'סגירת התמונה' }))
    expect(await card().findByRole('img', { name: 'תמונת המוצר' })).toBeInTheDocument()
  })

  it('shows no picture of a product when the task has none set, or is not a pickup', async () => {
    openWith([attachment('p1')], { task: pickup })
    await loaded(1)
    expect(card().queryByRole('img', { name: 'תמונת המוצר' })).not.toBeInTheDocument()
  })

  it('does not show or mark a product picture on a task of another kind, even if one is set', async () => {
    const { user } = openWith([attachment('p1')], { task: { kind: 'delivery', thumb_attachment_id: 'p1' } })
    await loaded(1)
    expect(card().queryByRole('img', { name: 'תמונת המוצר' })).not.toBeInTheDocument()
    expect(thumbs()[0]).toHaveAttribute('aria-label', 'תמונה 1 מתוך 1')
    expect(within(thumbs()[0]).queryByText('תמונת מוצר')).not.toBeInTheDocument()
    await user.click(thumbs()[0])
    expect(viewer().queryByText('זו תמונת המוצר')).not.toBeInTheDocument()
  })

  it('takes the product picture away from the task when that picture is deleted', async () => {
    const { user, backend } = openWith([attachment('p1'), attachment('p2')], { task: { ...pickup, thumb_attachment_id: 'p2' } })
    await loaded(2)
    await user.click(thumbs()[1])
    await user.click(viewer().getByRole('button', { name: 'מחיקת התמונה' }))
    await user.click(viewer().getByRole('button', { name: 'כן, למחוק' }))

    await waitFor(() => expect(lastUpsert(backend)?.patch).toEqual({ thumb_attachment_id: null }))
    await waitFor(() => expect(card().queryByRole('img', { name: 'תמונת המוצר' })).not.toBeInTheDocument())
  })

  it('leaves the product picture alone when another picture is deleted', async () => {
    const { user, backend } = openWith([attachment('p1'), attachment('p2')], { task: { ...pickup, thumb_attachment_id: 'p2' } })
    await loaded(2)
    await user.click(thumbs()[0])
    await user.click(viewer().getByRole('button', { name: 'מחיקת התמונה' }))
    await user.click(viewer().getByRole('button', { name: 'כן, למחוק' }))

    await waitFor(() => expect(thumbs()).toHaveLength(1))
    expect(backend.tasks.upserts).toHaveLength(0)
    expect(await card().findByRole('img', { name: 'תמונת המוצר' })).toBeInTheDocument()
  })

  it('keeps the product picture on the task when deleting the picture fails', async () => {
    const { user, backend, store } = openWith([attachment('p1')], { task: { ...pickup, thumb_attachment_id: 'p1' } })
    await loaded(1)
    await user.click(thumbs()[0])
    await user.click(viewer().getByRole('button', { name: 'מחיקת התמונה' }))
    store.failNext(refusal(400))
    await user.click(viewer().getByRole('button', { name: 'כן, למחוק' }))
    await viewer().findByRole('alert')
    expect(backend.tasks.upserts).toHaveLength(0)
  })
})

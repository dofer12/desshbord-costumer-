// Makes the icons of every target from one drawing: the Windows icon and the tray icon, the launcher icons
// of Android (all densities: the square ones, the round ones and the adaptive foreground), the icons of the
// web app and the favicon. The drawing is the SVG below; the PNGs are made with the Electron that is already
// installed (a hidden window draws the SVG and takes a picture of it), so there is nothing else to install.
//
//   npx electron scripts/make-icons.cjs
//
// The files that it writes are in the repository: run it again only when the drawing changes.
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

// One pixel is one pixel, whatever the scale of the screen that this runs on.
app.commandLine.appendSwitch('force-device-scale-factor', '1')

const root = join(__dirname, '..')
const SIZE = 1024
const NS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"'

const GRADIENT =
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14808c"/><stop offset="1" stop-color="#0a5159"/></linearGradient></defs>'

// A white tick, and a small amber dot that is the badge of a reminder.
const MARK =
  '<path d="M138 272 L226 358 L380 176" fill="none" stroke="#ffffff" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<circle cx="386" cy="124" r="40" fill="#f5a524" stroke="#ffffff" stroke-width="12"/>'

// The middle of the mark is not the middle of the picture: it is moved there, and made smaller, for the shapes that cut the corners.
const centred = (scale) => `<g transform="translate(256 256) scale(${scale}) translate(-270 -232)">${MARK}</g>`

const VARIANTS = {
  // A square with round corners: the icon of the app, the favicon and the Windows icon.
  icon: `<svg ${NS}>${GRADIENT}<rect width="512" height="512" rx="112" fill="url(#g)"/>${MARK}</svg>`,
  // To the edges, for the places that cut their own shape (a maskable icon, the icon of an Apple device).
  full: `<svg ${NS}>${GRADIENT}<rect width="512" height="512" fill="url(#g)"/>${centred(0.9)}</svg>`,
  // A circle, for the round launcher icon of old versions of Android.
  round: `<svg ${NS}>${GRADIENT}<circle cx="256" cy="256" r="256" fill="url(#g)"/>${centred(0.82)}</svg>`,
  // Nothing behind it, and small enough to stay inside the middle two thirds, which is all that an adaptive icon always shows.
  foreground: `<svg ${NS}>${centred(0.7)}</svg>`,
}

const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
const res = 'android/app/src/main/res'
const OUTPUTS = [
  ['icon', 512, 'build/icon.png'],
  ['icon', 32, 'build/tray.png'],
  ['icon', 192, 'public/icons/icon-192.png'],
  ['icon', 512, 'public/icons/icon-512.png'],
  ['full', 512, 'public/icons/icon-maskable-512.png'],
  ['full', 180, 'public/icons/apple-touch-icon.png'],
  ...Object.entries(DENSITY).flatMap(([name, scale]) => [
    ['icon', 48 * scale, `${res}/mipmap-${name}/ic_launcher.png`],
    ['round', 48 * scale, `${res}/mipmap-${name}/ic_launcher_round.png`],
    ['foreground', 108 * scale, `${res}/mipmap-${name}/ic_launcher_foreground.png`],
  ]),
]

/** The picture of a drawing, SIZE pixels square, with nothing behind it, painted to memory by a window that is never shown. */
async function draw(window, svg) {
  const page =
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}` +
    `img{display:block;width:${SIZE}px;height:${SIZE}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`
  await window.loadURL(`data:text/html;base64,${Buffer.from(page).toString('base64')}`)
  // Time for the drawing to be decoded, and then a new frame that has it in it.
  await new Promise((resolve) => setTimeout(resolve, 400))
  return new Promise((resolve) => {
    window.webContents.once('paint', (_event, _dirty, frame) => resolve(frame))
    window.webContents.invalidate()
  })
}

function write(path, data) {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, data)
  console.log('wrote', path)
}

app.whenReady().then(async () => {
  try {
    write('build/icon.svg', VARIANTS.icon + '\n')
    write('public/favicon.svg', VARIANTS.icon + '\n')
    const window = new BrowserWindow({
      show: false,
      width: SIZE,
      height: SIZE,
      useContentSize: true,
      frame: false,
      transparent: true,
      resizable: false,
      webPreferences: { offscreen: true },
    })
    window.webContents.setFrameRate(5)
    for (const name of Object.keys(VARIANTS)) {
      const image = await draw(window, VARIANTS[name])
      for (const [variant, size, path] of OUTPUTS) {
        if (variant !== name) continue
        write(path, image.resize({ width: size, height: size, quality: 'best' }).toPNG())
      }
    }
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})

// The service worker of the web app. It keeps the shell of the app (the page, and the files whose names carry
// a hash of their content) so that the app opens fast, and so that a person who is offline sees the app and
// its own message about the connection and not a page of the browser. It never keeps anything of the server
// (the data, the pictures, the sign-in): a request to another address is not touched at all.
//
// Change CACHE when what this file does changes: the old copy is deleted when the new worker takes over.
const CACHE = 'moked-shell-v1'

self.addEventListener('install', () => {
  // A new worker takes over at once; the page asks the network first, so a new version is seen on the next visit.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // The server, the fonts of another address, anything that is not this app: left to the browser.
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    // The page: the network first, so that a new version is never hidden by an old copy; the copy when there is no network.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put('./index.html', copy))
          }
          return response
        })
        .catch(() => caches.match('./index.html').then((copy) => copy || Response.error())),
    )
    return
  }

  // The files that the build gave a name with a hash in it never change, so the copy is as good as the file: the copy first.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(CACHE).then((cache) => cache.put(request, copy))
            }
            return response
          }),
      ),
    )
  }
})

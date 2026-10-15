/**
 * Puts text on the clipboard. It says whether that worked: a browser that refuses, or that has no
 * clipboard (a page that is not secure, an old WebView), is an answer for the caller, not an error.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Refused (no permission, the page is not in front): try the older way.
  }
  return copyBySelecting(text)
}

/** The older way: select the text in a field that is only there for a moment, and ask the browser to copy it. */
function copyBySelecting(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.focus()
  field.select()
  field.setSelectionRange(0, text.length)
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
    before?.focus()
  }
}

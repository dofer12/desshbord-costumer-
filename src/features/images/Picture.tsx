import { useState } from 'react'
import { useSignedUrl } from './useSignedUrl'

interface Props {
  /** The path of the file in the private bucket. */
  path: string
  /** What a screen reader says. Empty when the picture only decorates a button that has a name of its own. */
  alt: string
  className?: string
}

/** A picture of the private bucket: an empty place while its address comes, and a word when it cannot be shown. */
export function Picture({ path, alt, className }: Props) {
  const { url, failed } = useSignedUrl(path)
  // The address that the browser could not load, so that a new address is tried.
  const [broken, setBroken] = useState<string | null>(null)

  if (failed || (url !== null && url === broken)) return <span className="picture-gone">התמונה לא זמינה</span>
  if (url === null) return <span className="picture-wait" aria-hidden="true" />
  return <img className={className} src={url} alt={alt} onError={() => setBroken(url)} />
}

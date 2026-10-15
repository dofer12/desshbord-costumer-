interface Props {
  page: number
  pageCount: number
  onPage(page: number): void
}

/** The way from page to page of a long list. It is not there when there is one page. */
export function Pager({ page, pageCount, onPage }: Props) {
  if (pageCount <= 1) return null
  return (
    <nav className="pager" aria-label="דפדוף בין עמודים">
      <button type="button" className="btn" disabled={page <= 1} aria-label="העמוד הקודם" onClick={() => onPage(page - 1)}>
        <span aria-hidden="true">→</span> הקודם
      </button>
      <span>
        עמוד {page} מתוך {pageCount}
      </span>
      <button type="button" className="btn" disabled={page >= pageCount} aria-label="העמוד הבא" onClick={() => onPage(page + 1)}>
        הבא <span aria-hidden="true">←</span>
      </button>
    </nav>
  )
}

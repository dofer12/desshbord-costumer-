// Reading and writing the files of the import and the backup: CSV that Excel, Google Sheets and the old
// app all produce. Everything here is pure text in and text out; what the columns mean is for the files
// beside it (legacyFormat.ts, ordersImport.ts).

const BOM = String.fromCharCode(0xfeff)
const REPLACEMENT = String.fromCharCode(0xfffd)
const DELIMITERS = [',', '\t', ';'] as const
/** More characters of a file that UTF-8 could not read than this, and the file is read as Windows-1255. */
const MAX_UNREADABLE = 3

/**
 * The cells of a CSV file, row by row. The delimiter is the one of `,` `\t` `;` that cuts the first line
 * into most parts; a cell may be in quotes, with a doubled quote for a quote and any line break inside;
 * a line ends with \r\n, \n or \r, or with the end of the text; a row with nothing in any cell is left
 * out. The cells are as they are in the file (the readers trim). A quote that is never closed runs to the
 * end of the text, and nothing here throws.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charAt(0) === BOM ? input.slice(1) : input
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? ''
  const delimiter = DELIMITERS.map((candidate) => [candidate, firstLine.split(candidate).length] as const).sort((a, b) => b[1] - a[1])[0][0]

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  const endRow = () => {
    row.push(cell)
    cell = ''
    if (row.some((value) => value.trim() !== '')) rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') {
        cell += c
      } else if (text[i + 1] === '"') {
        cell += '"'
        i++
      } else {
        quoted = false
      }
    } else if (c === '"' && cell === '') {
      quoted = true
    } else if (c === delimiter) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else {
      cell += c
    }
  }
  endRow()
  return rows
}

/**
 * The text of a CSV file for the cells: a BOM first, so that Excel reads the Hebrew, every cell in quotes
 * (a quote is doubled), lines ended with \r\n and no line end after the last one. parseCsv reads it back
 * to the same cells, whatever is in them.
 */
export function toCsv(rows: string[][]): string {
  const quote = (cell: string) => '"' + cell.replaceAll('"', '""') + '"'
  return BOM + rows.map((row) => row.map(quote).join(',')).join('\r\n')
}

// A number or a phone number that begins with a sign: digits, spaces, dashes, dots and brackets, and nothing that a spreadsheet could calculate with.
const SIGNED_NUMBER = /^[+-]\d[\d\s\-().]*$/

/** Whether a spreadsheet could take the text for a formula: it begins with = @ + - a tab or a line end, and is not a plain number. */
function startsLikeFormula(cell: string): boolean {
  const first = cell.charAt(0)
  if (first === '=' || first === '@' || first === '\t' || first === '\r') return true
  return (first === '+' || first === '-') && !SIGNED_NUMBER.test(cell)
}

/** A text that a person (or a file) could make a spreadsheet run, and a text that begins with an apostrophe before one: both need the guard. */
function needsGuard(cell: string): boolean {
  return startsLikeFormula(cell) || (cell.charAt(0) === "'" && needsGuard(cell.slice(1)))
}

/**
 * The text as it is to be written in a file that a spreadsheet will open: a text that begins like a
 * formula gets an apostrophe in front, so that it stays a text. Numbers and phone numbers, with or without
 * a sign, are left alone, and so is any other text.
 */
export function neutralizeFormula(cell: string): string {
  return needsGuard(cell) ? "'" + cell : cell
}

/** The text that neutralizeFormula was given: the apostrophe that it put in front is taken off, and nothing else is. */
export function restoreFormula(cell: string): string {
  return cell.charAt(0) === "'" && needsGuard(cell.slice(1)) ? cell.slice(1) : cell
}

/**
 * The text of the bytes of a CSV file: UTF-8, and Windows-1255 (what Excel in Hebrew writes) when UTF-8
 * could not read more than three characters. Bytes that are not text at all do not throw.
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (utf8.split(REPLACEMENT).length - 1 <= MAX_UNREADABLE) return utf8
  try {
    return new TextDecoder('windows-1255').decode(bytes)
  } catch {
    return utf8
  }
}

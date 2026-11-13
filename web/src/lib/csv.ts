// Just enough CSV to trade files with a spreadsheet: quoted cells, doubled
// quotes, commas and line breaks inside quotes, either kind of line ending.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Spreadsheets like to leave blank lines at the end.
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export type CsvValue = string | number | boolean | null | undefined;

/**
 * A spreadsheet would run a cell that starts with = + - or @ as a formula.
 * Text we write gets a leading apostrophe in that case; `unguard` takes it off again.
 */
export const guard = (text: string) => (/^[=+\-@]/.test(text) ? `'${text}` : text);
export const unguard = (text: string) => (/^'[=+\-@]/.test(text) ? text.slice(1) : text);

export function toCsv(rows: CsvValue[][]): string {
  const cell = (value: CsvValue) => {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Reads a CSV with a header row into one object per row, keyed by lower-cased header. */
export function parseTable(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const [head = [], ...body] = parseCsv(text);
  const headers = head.map((h) => h.trim());
  const keys = headers.map((h) => h.toLowerCase());
  return {
    headers,
    rows: body.map((cells) => Object.fromEntries(keys.map((k, i) => [k, unguard((cells[i] ?? '').trim())]))),
  };
}

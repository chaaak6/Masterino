import { link, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { createRichDocument, type CreateRichDocumentParams } from './createRichDocument';

export interface CreateSpreadsheetParams extends CreateRichDocumentParams {
  path: string;
  sheets?: { name: string; rows: (string | number | boolean | null)[][] }[];
}
/** Finite, offline SheetJS writer. Creates a new simple xlsx; never replaces an original. */
export async function createOfficeDocument(params: CreateSpreadsheetParams) {
  if (path.extname(params.path).toLowerCase() !== '.xlsx') return createRichDocument(params);
  if (!Array.isArray(params.sheets) || !params.sheets.length || params.sheets.length > 20)
    throw new Error('Provide 1–20 sheets');
  if (JSON.stringify(params.sheets).length > 4 * 1024 * 1024)
    throw new Error('Spreadsheet input exceeds 4 MiB');
  const book = XLSX.utils.book_new();
  let count = 0;
  for (const sheet of params.sheets) {
    if (!Array.isArray(sheet.rows)) throw new Error('Sheet rows must be arrays');
    for (const row of sheet.rows) {
      if (!Array.isArray(row) || row.length > 256)
        throw new Error('Rows must contain at most 256 cells');
      count += row.length;
      if (count > 100_000 || sheet.rows.length > 20_000)
        throw new Error('Spreadsheet exceeds cell/row limit');
      if (row.some((v) => v !== null && !['string', 'number', 'boolean'].includes(typeof v)))
        throw new Error('Only literal string, number, boolean and null cells are supported');
      if (row.some((v) => typeof v === 'number' && !Number.isFinite(v)))
        throw new Error('Numeric cells must be finite');
    }
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  }
  const temp = path.join(path.dirname(params.path), `.masterino-office-${randomUUID()}.xlsx`);
  try {
    await writeFile(
      temp,
      XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }),
      { flag: 'wx' },
    );
    const checked = XLSX.read(await readFile(temp), { type: 'buffer' });
    if (checked.SheetNames.length !== params.sheets.length)
      throw new Error('Spreadsheet validation failed');
    // An exclusive hard link atomically publishes the complete same-filesystem temp file.
    // Existing destinations fail with EEXIST, including concurrent creator races.
    await link(temp, params.path);
    const result = await stat(params.path);
    return {
      path: params.path,
      format: 'xlsx',
      cells: count,
      sheets: checked.SheetNames,
      version: `${result.size}:${result.mtimeMs}:${result.ino}`,
    };
  } finally {
    await rm(temp, { force: true });
  }
}

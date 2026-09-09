import { randomUUID } from 'node:crypto';
import { link, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import * as XLSX from 'xlsx';

import { openOfficeZip } from './zip';

export interface OfficeBatchParams {
  operations: { sheet: string; cell: string; value: string | number | boolean | null }[];
  outputPath: string;
  path: string;
  version?: string;
}
export interface OfficeTemplateParams {
  outputPath: string;
  path: string;
  values: Record<string, string>;
  version?: string;
}
const fileVersion = async (file: string) => {
  const s = await stat(file);
  return `${s.size}:${s.mtimeMs}:${s.ino}`;
};
async function loadWorkbook(file: string, version?: string) {
  const before = await fileVersion(file);
  if (version && version !== before) throw new Error('OFFICE_VERSION_CHANGED');
  if (path.extname(file).toLowerCase() !== '.xlsx')
    throw new Error('Local modification supports xlsx only');
  if ((await stat(file)).size > 10 * 1024 * 1024)
    throw new Error('Local modification supports xlsx files up to 10 MiB');
  const zip = await openOfficeZip(file);
  try {
    let expanded = 0;
    for (const entry of zip.entries.values()) expanded += entry.uncompressedSize;
    if (expanded > 64 * 1024 * 1024)
      throw new Error('Workbook expansion exceeds 64 MiB modification limit');
    // SheetJS rewrites a workbook: explicitly reject features this finite writer cannot preserve.
    if (
      [...zip.entries.keys()].some((p) =>
        /vbaProject|drawings\/|charts\/|externalLinks\/|pivotTables\/|embeddings\//i.test(p),
      )
    )
      throw new Error(
        'Workbook has unsupported features; local writer cannot guarantee preservation',
      );
  } finally {
    zip.close();
  }
  const book = XLSX.read(await readFile(file), { type: 'buffer', cellStyles: true, cellNF: true });
  if ((await fileVersion(file)) !== before) throw new Error('OFFICE_VERSION_CHANGED');
  return { book, before };
}
async function publishWorkbook(
  book: XLSX.WorkBook,
  source: string,
  output: string,
  before: string,
) {
  if (path.extname(output).toLowerCase() !== '.xlsx')
    throw new Error('Output must be a new .xlsx file');
  const temp = path.join(path.dirname(output), `.masterino-office-${randomUUID()}.xlsx`);
  try {
    await writeFile(
      temp,
      XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }),
      { flag: 'wx' },
    );
    const parsed = XLSX.read(await readFile(temp), { type: 'buffer', cellFormula: true });
    for (const name of book.SheetNames) {
      const sheet = book.Sheets[name]!;
      for (const [address, cell] of Object.entries(sheet)) {
        if (address.startsWith('!')) continue;
        if (cell.f !== parsed.Sheets[name]?.[address]?.f)
          throw new Error('Formula preservation validation failed');
      }
    }
    if ((await fileVersion(source)) !== before) throw new Error('OFFICE_VERSION_CHANGED');
    await link(temp, output);
    return {
      path: output,
      version: await fileVersion(output),
      format: 'xlsx',
      validation: 'structure and formulas; visual formatting not verified',
    };
  } finally {
    await rm(temp, { force: true });
  }
}
export async function batchOfficeDocument(params: OfficeBatchParams) {
  if (
    !Array.isArray(params.operations) ||
    params.operations.length > 10_000 ||
    JSON.stringify(params.operations).length > 4 * 1024 * 1024
  )
    throw new Error('Batch exceeds 10000 operations or 4 MiB');
  const { book, before } = await loadWorkbook(params.path, params.version);
  for (const operation of params.operations) {
    const sheet = book.Sheets[operation.sheet];
    if (!sheet || !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(operation.cell))
      throw new Error('Invalid sheet or cell');
    const location = XLSX.utils.decode_cell(operation.cell);
    if (location.c >= 16384 || location.r >= 1048576) throw new Error('Cell exceeds Excel bounds');
    const value = operation.value;
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value))
      throw new Error('Only literal cell values are supported');
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('Numeric cells must be finite');
    if (value === null) delete sheet[operation.cell];
    else XLSX.utils.sheet_add_aoa(sheet, [[value]], { origin: operation.cell });
  }
  return {
    ...(await publishWorkbook(book, params.path, params.outputPath, before)),
    modifiedCells: params.operations.length,
  };
}
export async function mergeOfficeTemplate(params: OfficeTemplateParams) {
  if (
    !params.values ||
    Object.keys(params.values).length > 1000 ||
    JSON.stringify(params.values).length > 1024 * 1024 ||
    Object.values(params.values).some((v) => typeof v !== 'string')
  )
    throw new Error('Template values exceed supported limits');
  const { book, before } = await loadWorkbook(params.path, params.version);
  let replacements = 0;
  for (const name of book.SheetNames) {
    for (const [address, cell] of Object.entries(book.Sheets[name]!)) {
      if (address.startsWith('!') || cell.t !== 's' || cell.f) continue;
      cell.v = String(cell.v).replaceAll(/\{\{([\w.-]+)\}\}/g, (match, key: string) => {
        if (!Object.hasOwn(params.values, key)) return match;
        replacements++;
        return params.values[key]!;
      });
      delete cell.w;
      delete cell.h;
      delete cell.r;
    }
  }
  return { ...(await publishWorkbook(book, params.path, params.outputPath, before)), replacements };
}
export async function validateOfficeDocument(params: { path: string; version?: string }) {
  const { book, before } = await loadWorkbook(params.path, params.version);
  return {
    version: before,
    valid: true,
    sheets: book.SheetNames,
    scope: 'supported xlsx package structure; no recalculation or visual validation',
  };
}

import { CSV_MAX_BYTES, type CsvHeader, type ImportResultResponse } from '../shared/csv-contract';
import { CsvContractError, parseCsvBytes } from './csv-parser';
import { preflightExactMatch } from './exact-match';
import { executeImportWrite } from './import-write';
import { validateCsvRows } from './csv-validator';

export interface ImportErrorField {
  path: string;
  code: string;
  message: string;
}

export class ImportRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: ImportErrorField[] = [],
    readonly incidentId: string | null = null,
  ) {
    super(message);
    this.name = 'ImportRequestError';
  }
}

function randomImportId(): string {
  return `imp_${crypto.randomUUID().replaceAll('-', '')}`;
}

async function deleteOriginal(files: R2Bucket, key: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await files.delete(key);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function fatalCsvError(error: CsvContractError): ImportRequestError {
  const status = error.code === 'csv_size_exceeded' || error.code === 'csv_row_limit_exceeded' ? 413 : 400;
  const fields = error.row === null ? [] : [{
    path: `/rows/${error.row}`,
    code: error.code,
    message: error.message,
  }];
  return new ImportRequestError(status, error.code, error.message, fields);
}

async function compensateOrReplaceError(
  files: R2Bucket,
  key: string,
  original: unknown,
): Promise<never> {
  try {
    await deleteOriginal(files, key);
  } catch (compensationError) {
    const incidentId = crypto.randomUUID();
    console.error('CSV import storage compensation failure', { incidentId, compensationError });
    throw new ImportRequestError(
      500,
      'storage_compensation_failed',
      'Import storage compensation failed.',
      [],
      incidentId,
    );
  }
  if (original instanceof ImportRequestError) throw original;
  if (original instanceof CsvContractError) throw fatalCsvError(original);
  const incidentId = crypto.randomUUID();
  console.error('CSV import persistence failure', { incidentId, error: original });
  throw new ImportRequestError(500, 'persistence_failed', 'The CSV import could not be committed.', [], incidentId);
}

export async function executeCsvImport(input: {
  database: D1Database;
  files: R2Bucket;
  filename: string;
  bytes: Uint8Array;
  confirmedVariants: boolean;
}): Promise<ImportResultResponse> {
  if (input.bytes.byteLength > CSV_MAX_BYTES) {
    throw new ImportRequestError(413, 'csv_size_exceeded', `CSV files must be ${CSV_MAX_BYTES.toLocaleString('en-US')} bytes or smaller.`);
  }

  const importId = randomImportId();
  const privateObjectKey = `imports/${crypto.randomUUID()}.csv`;
  let object: R2Object;
  try {
    object = await input.files.put(privateObjectKey, input.bytes, {
      httpMetadata: { contentType: 'text/csv; charset=utf-8' },
    });
  } catch (error) {
    const incidentId = crypto.randomUUID();
    console.error('CSV import storage write failure', { incidentId, error });
    throw new ImportRequestError(500, 'storage_write_failed', 'The original CSV could not be stored.', [], incidentId);
  }
  if (object.size !== input.bytes.byteLength) {
    return compensateOrReplaceError(
      input.files,
      privateObjectKey,
      new ImportRequestError(500, 'storage_write_failed', 'The stored CSV did not match the uploaded body.'),
    );
  }

  try {
    const parsed = parseCsvBytes(input.bytes);
    const validation = validateCsvRows(parsed.rows);
    if (validation.confirmationRequired && !input.confirmedVariants) {
      throw new ImportRequestError(
        422,
        'variant_confirmation_required',
        'Confirm every eligible Product group with 11 to 30 combinations.',
        [{
          path: '/headers/X-Nexus-Confirm-Variants',
          code: 'variant_confirmation_required',
          message: 'Set X-Nexus-Confirm-Variants:true after reviewing the eligible warning groups.',
        }],
      );
    }
    if (!validation.confirmationRequired && input.confirmedVariants) {
      throw new ImportRequestError(
        422,
        'validation_failed',
        'Variant confirmation is accepted only when an eligible Product group has 11 to 30 combinations.',
        [{
          path: '/headers/X-Nexus-Confirm-Variants',
          code: 'confirmation_not_required',
          message: 'Omit the confirmation header when no eligible warning group requires it.',
        }],
      );
    }
    const plan = await preflightExactMatch(input.database, validation);
    return await executeImportWrite({
      database: input.database,
      plan,
      importId,
      filename: input.filename,
      sizeBytes: parsed.byteLength,
      privateObjectKey,
    });
  } catch (error) {
    return compensateOrReplaceError(input.files, privateObjectKey, error);
  }
}

export function csvResultFieldPath(row: number, field: CsvHeader | null): string {
  return field === null ? `/rows/${row}` : `/rows/${row}/${field}`;
}

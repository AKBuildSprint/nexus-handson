import { CSV_MAX_BYTES, type CsvHeader, type ImportResultResponse } from '../shared/csv-contract';
import type { ConsoleIdentityContext } from '@nexus/identity/identity-types';
import { CsvContractError, parseCsvBytes } from './csv-parser';
import { preflightExactMatch } from './exact-match';
import { executeImportWrite, ImportPersistenceError } from './import-write';
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
    console.error('CSV import storage compensation failure', { incidentId, classification: 'delete_failed' });
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
  console.error('CSV import persistence failure', { incidentId, classification: 'confirmed_not_committed' });
  throw new ImportRequestError(500, 'persistence_failed', 'The CSV import could not be committed.', [], incidentId);
}

function retainedImportFailure(_error: unknown): never {
  const incidentId = crypto.randomUUID();
  console.error('CSV import commit outcome requires reconciliation', { incidentId, classification: 'committed_or_unknown' });
  throw new ImportRequestError(
    500,
    'persistence_failed',
    'The CSV import outcome could not be confirmed automatically.',
    [],
    incidentId,
  );
}

export async function executeCsvImport(input: {
  database: D1Database;
  files: R2Bucket;
  identity: ConsoleIdentityContext;
  filename: string;
  bytes: Uint8Array;
  confirmedVariants: boolean;
}): Promise<ImportResultResponse> {
  if (input.bytes.byteLength > CSV_MAX_BYTES) {
    throw new ImportRequestError(413, 'csv_size_exceeded', `CSV files must be ${CSV_MAX_BYTES.toLocaleString('en-US')} bytes or smaller.`);
  }

  const importId = randomImportId();
  const privateObjectKey = `imports/${crypto.randomUUID()}.csv`;
  let writeAttempted = false;
  let object: R2Object;
  try {
    object = await input.files.put(privateObjectKey, input.bytes, {
      httpMetadata: { contentType: 'text/csv; charset=utf-8' },
    });
  } catch (error) {
    const incidentId = crypto.randomUUID();
    console.error('CSV import storage write failure', { incidentId, classification: 'put_failed' });
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
    const plan = await preflightExactMatch(input.database, input.identity.storeId, validation);
    writeAttempted = true;
    return await executeImportWrite({
      database: input.database,
      identity: input.identity,
      plan,
      importId,
      filename: input.filename,
      sizeBytes: parsed.byteLength,
      privateObjectKey,
    });
  } catch (error) {
    if (writeAttempted && error instanceof ImportPersistenceError) {
      try {
        const association = await input.database.prepare(
          `SELECT private_object_key AS privateObjectKey
             FROM imports WHERE store_id=? AND id=?`,
        ).bind(input.identity.storeId, importId).first<{ privateObjectKey: string }>();
        if (association !== null) return retainedImportFailure(error);
        const stillAuthorized = await input.database.prepare(
          `SELECT EXISTS (
             SELECT 1 FROM store_memberships
              WHERE id=? AND store_id=? AND user_id=? AND role='owner' AND status='active'
           ) AS authorized`,
        ).bind(
          input.identity.membershipId, input.identity.storeId, input.identity.userId,
        ).first<number>('authorized');
        if (stillAuthorized !== 1) {
          return compensateOrReplaceError(
            input.files,
            privateObjectKey,
            new ImportRequestError(403, 'store_access_denied', 'Current Store access is required.'),
          );
        }
      } catch (lookupError) {
        if (lookupError instanceof ImportRequestError) throw lookupError;
        return retainedImportFailure(lookupError);
      }
    }
    return compensateOrReplaceError(input.files, privateObjectKey, error);
  }
}

export function csvResultFieldPath(row: number, field: CsvHeader | null): string {
  return field === null ? `/rows/${row}` : `/rows/${row}/${field}`;
}

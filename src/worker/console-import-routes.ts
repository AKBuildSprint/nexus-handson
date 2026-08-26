import { executeCsvImport, ImportRequestError } from '../import/import-command';
import {
  CSV_CONFIRMATION_HEADER,
  CSV_CONTENT_TYPE,
  CSV_FILENAME,
  CSV_FILENAME_HEADER,
  CSV_MAX_BYTES,
  CSV_TEMPLATE,
} from '../shared/csv-contract';
import type { Env } from './environment';
import { jsonError, jsonResponse } from './http-response';

function decodeImportFilename(encoded: string | null): string {
  if (!encoded) throw new ImportRequestError(422, 'validation_failed', `${CSV_FILENAME_HEADER} is required.`);
  let filename: string;
  try {
    filename = decodeURIComponent(encoded);
  } catch {
    throw new ImportRequestError(422, 'validation_failed', `${CSV_FILENAME_HEADER} must be percent-encoded UTF-8.`);
  }
  if (filename.trim() === '' || filename.length > 255 || /[\u0000-\u001f/\\]/u.test(filename)) {
    throw new ImportRequestError(422, 'validation_failed', 'The CSV filename is invalid.');
  }
  return filename;
}

function errorResponse(error: ImportRequestError): Response {
  return jsonError(error.status, error.code, error.message, error.fields, error.incidentId);
}

export async function routeConsoleImportRequest(request: Request, env: Pick<Env, 'DB' | 'FILES'>): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/api/console/imports/template' && request.method === 'GET') {
    return new Response(CSV_TEMPLATE, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${CSV_FILENAME}"`,
        'Content-Type': CSV_CONTENT_TYPE,
      },
    });
  }
  if (pathname !== '/api/console/imports' || request.method !== 'POST') return null;

  try {
    if (request.headers.get('Content-Type')?.trim().toLowerCase() !== CSV_CONTENT_TYPE) {
      throw new ImportRequestError(400, 'invalid_csv', `Content-Type must be ${CSV_CONTENT_TYPE}.`);
    }
    const declaredHeader = request.headers.get('Content-Length');
    if (declaredHeader !== null) {
      const declared = Number(declaredHeader);
      if (!Number.isSafeInteger(declared) || declared < 0) {
        throw new ImportRequestError(400, 'invalid_csv', 'Content-Length is invalid.');
      }
      if (declared > CSV_MAX_BYTES) {
        throw new ImportRequestError(413, 'csv_size_exceeded', `CSV files must be ${CSV_MAX_BYTES.toLocaleString('en-US')} bytes or smaller.`);
      }
    }
    const filename = decodeImportFilename(request.headers.get(CSV_FILENAME_HEADER));
    const bytes = new Uint8Array(await request.arrayBuffer());
    const result = await executeCsvImport({
      database: env.DB,
      files: env.FILES,
      filename,
      bytes,
      confirmedVariants: request.headers.get(CSV_CONFIRMATION_HEADER) === 'true',
    });
    return jsonResponse(result);
  } catch (error) {
    if (error instanceof ImportRequestError) return errorResponse(error);
    const incidentId = crypto.randomUUID();
    console.error('Unexpected CSV import route failure', { incidentId, error });
    return jsonError(500, 'persistence_failed', 'The CSV import could not be completed.', [], incidentId);
  }
}

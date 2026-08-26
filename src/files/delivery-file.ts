import { DELIVERY_FILE_BYTES_MAX } from '../shared/catalog-limits';
import type { FileKind, PrivateFileSummary } from '../catalog/catalog-types';
import { BOOTSTRAP_STORE_ID, readProductRevision } from '../catalog/catalog-read';

export class DeliveryFileError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly incidentId: string | null = null,
  ) {
    super(message);
    this.name = 'DeliveryFileError';
  }
}

export function decodeDeliveryFilename(encoded: string | null): string {
  if (encoded === null || encoded === '') {
    throw new DeliveryFileError(422, 'validation_failed', 'X-Nexus-Filename is required.');
  }
  let filename: string;
  try {
    filename = decodeURIComponent(encoded);
  } catch {
    throw new DeliveryFileError(422, 'validation_failed', 'X-Nexus-Filename is not valid percent-encoded UTF-8.');
  }
  if (filename.trim() === '' || filename.length > 255 || /[\u0000-\u001f/\\]/u.test(filename)) {
    throw new DeliveryFileError(422, 'validation_failed', 'The delivery filename is invalid.');
  }
  return filename;
}

function detectedKind(prefix: Uint8Array): FileKind | null {
  if (prefix.length >= 5 && prefix[0] === 0x25 && prefix[1] === 0x50 && prefix[2] === 0x44 && prefix[3] === 0x46 && prefix[4] === 0x2d) {
    return 'pdf';
  }
  if (prefix.length >= 4 && prefix[0] === 0x50 && prefix[1] === 0x4b &&
      ((prefix[2] === 0x03 && prefix[3] === 0x04) || (prefix[2] === 0x05 && prefix[3] === 0x06) || (prefix[2] === 0x07 && prefix[3] === 0x08))) {
    return 'zip';
  }
  return null;
}

export async function inspectAndCountDeliveryBody(body: ReadableStream<Uint8Array> | null): Promise<{
  kind: FileKind;
  stream: ReadableStream<Uint8Array>;
  byteCount: () => number;
  streamError: () => DeliveryFileError | null;
}> {
  if (body === null) throw new DeliveryFileError(415, 'delivery_file_type_invalid', 'A PDF or ZIP body is required.');
  const reader = body.getReader();
  const initialChunks: Uint8Array[] = [];
  let prefixLength = 0;
  while (prefixLength < 5) {
    const result = await reader.read();
    if (result.done) break;
    initialChunks.push(result.value);
    prefixLength += result.value.byteLength;
  }
  const prefix = new Uint8Array(Math.min(prefixLength, 5));
  let prefixOffset = 0;
  for (const chunk of initialChunks) {
    const length = Math.min(chunk.byteLength, prefix.length - prefixOffset);
    prefix.set(chunk.subarray(0, length), prefixOffset);
    prefixOffset += length;
    if (prefixOffset === prefix.length) break;
  }
  const kind = detectedKind(prefix);
  if (kind === null) {
    await reader.cancel();
    throw new DeliveryFileError(415, 'delivery_file_type_invalid', 'Delivery files must contain actual PDF or ZIP bytes.');
  }
  let count = 0;
  let initialIndex = 0;
  let failure: DeliveryFileError | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = initialIndex < initialChunks.length
        ? { done: false as const, value: initialChunks[initialIndex++] }
        : await reader.read();
      if (result.done) {
        controller.close();
        return;
      }
      count += result.value.byteLength;
      if (count > DELIVERY_FILE_BYTES_MAX) {
        failure = new DeliveryFileError(413, 'delivery_file_size_exceeded', 'Delivery files may not exceed 25 MB.');
        controller.error(failure);
        await reader.cancel(failure);
        return;
      }
      controller.enqueue(result.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { kind, stream, byteCount: () => count, streamError: () => failure };
}

const MULTIPART_PART_BYTES = 5 * 1024 * 1024;

async function writeUnknownLengthStream(
  files: R2Bucket,
  key: string,
  stream: ReadableStream<Uint8Array>,
  kind: FileKind,
): Promise<{ object: R2Object; checksum: string }> {
  const upload = await files.createMultipartUpload(key, {
    httpMetadata: { contentType: kind === 'pdf' ? 'application/pdf' : 'application/zip' },
  });
  const reader = stream.getReader();
  const uploadedParts: R2UploadedPart[] = [];
  let partNumber = 1;
  let pending = new Uint8Array(MULTIPART_PART_BYTES);
  let pendingLength = 0;
  const cloudflareCrypto = crypto as Crypto & { DigestStream: typeof DigestStream };
  const digestStream = new cloudflareCrypto.DigestStream('SHA-256');
  const digestWriter = digestStream.getWriter();
  let streamedBytes = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      await digestWriter.write(result.value);
      streamedBytes += result.value.byteLength;
      let offset = 0;
      while (offset < result.value.byteLength) {
        const copied = Math.min(pending.byteLength - pendingLength, result.value.byteLength - offset);
        pending.set(result.value.subarray(offset, offset + copied), pendingLength);
        pendingLength += copied;
        offset += copied;
        if (pendingLength === pending.byteLength) {
          uploadedParts.push(await upload.uploadPart(partNumber, pending));
          partNumber += 1;
          pending = new Uint8Array(MULTIPART_PART_BYTES);
          pendingLength = 0;
        }
      }
    }
    if (pendingLength > 0) {
      uploadedParts.push(await upload.uploadPart(partNumber, pending.subarray(0, pendingLength)));
    }
    await digestWriter.close();
    if (Number(digestStream.bytesWritten) !== streamedBytes) {
      throw new Error('Delivery checksum byte count does not match the uploaded stream.');
    }
    const object = await upload.complete(uploadedParts);
    const digest = new Uint8Array(await digestStream.digest);
    const checksum = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return { object, checksum };
  } catch (error) {
    await digestWriter.abort(error).catch(() => undefined);
    try {
      await upload.abort();
    } catch {
      // The original write failure remains authoritative; no completed object exists yet.
    }
    throw error;
  }
}

async function compensateNewObject(files: R2Bucket, key: string): Promise<void> {
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

export interface DeliveryFileMutationResult {
  productId: string;
  variantId?: string;
  file: PrivateFileSummary;
  revision: number;
}

export async function putDeliveryFile(input: {
  db: D1Database;
  files: R2Bucket;
  productId: string;
  variantId: string | null;
  expectedRevision: number;
  filename: string;
  body: ReadableStream<Uint8Array> | null;
  declaredLength: string | null;
}): Promise<DeliveryFileMutationResult> {
  if (input.declaredLength !== null) {
    const declared = Number(input.declaredLength);
    if (!Number.isSafeInteger(declared) || declared < 0) {
      throw new DeliveryFileError(422, 'validation_failed', 'Content-Length is invalid.');
    }
    if (declared > DELIVERY_FILE_BYTES_MAX) {
      throw new DeliveryFileError(413, 'delivery_file_size_exceeded', 'Delivery files may not exceed 25 MB.');
    }
  }
  const revision = await readProductRevision(input.db, input.productId);
  if (revision === null) throw new DeliveryFileError(404, 'product_not_found', 'Product not found.');
  if (revision !== input.expectedRevision) throw new DeliveryFileError(409, 'revision_conflict', 'The Product revision has changed.');
  if (input.variantId !== null) {
    const variant = await input.db.prepare(
      `SELECT id FROM product_variants
        WHERE store_id=? AND product_id=? AND id=? AND current_schema=1 AND delivery_source='variant_override'`,
    ).bind(BOOTSTRAP_STORE_ID, input.productId, input.variantId).first<{ id: string }>();
    if (!variant) throw new DeliveryFileError(404, 'variant_not_found', 'Variant not found or does not use a complete override.');
  }
  const inspected = await inspectAndCountDeliveryBody(input.body);
  const key = `delivery/${crypto.randomUUID()}`;
  let object: R2Object;
  let checksum: string;
  try {
    const stored = await writeUnknownLengthStream(input.files, key, inspected.stream, inspected.kind);
    object = stored.object;
    checksum = stored.checksum;
  } catch (error) {
    const streamFailure = inspected.streamError();
    if (streamFailure) throw streamFailure;
    const incidentId = crypto.randomUUID();
    console.error('Delivery storage write failure', { incidentId, error });
    throw new DeliveryFileError(500, 'storage_write_failed', 'The delivery file could not be stored.', incidentId);
  }
  const actualSize = inspected.byteCount();
  if (object.size !== actualSize || actualSize > DELIVERY_FILE_BYTES_MAX) {
    try {
      await compensateNewObject(input.files, key);
    } catch {
      throw new DeliveryFileError(500, 'storage_compensation_failed', 'File storage compensation failed.', crypto.randomUUID());
    }
    throw new DeliveryFileError(500, 'storage_write_failed', 'The stored delivery file did not match the upload.', crypto.randomUUID());
  }
  try {
    if (input.variantId === null) {
      await input.db.batch([input.db.prepare(
        `UPDATE products SET
           name=CASE WHEN revision=? THEN name ELSE NULL END,
           delivery_file_key=?, delivery_file_filename=?, delivery_file_size=?, delivery_file_kind=?, delivery_file_checksum=?,
           revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE store_id=? AND id=?`,
      ).bind(input.expectedRevision, key, input.filename, actualSize, inspected.kind, checksum, BOOTSTRAP_STORE_ID, input.productId)]);
    } else {
      await input.db.batch([
        input.db.prepare(
          `UPDATE product_variants SET delivery_file_key=?, delivery_file_filename=?, delivery_file_size=?,
             delivery_file_kind=?, delivery_file_checksum=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE store_id=? AND product_id=? AND id=? AND current_schema=1 AND delivery_source='variant_override'`,
        ).bind(key, input.filename, actualSize, inspected.kind, checksum, BOOTSTRAP_STORE_ID, input.productId, input.variantId),
        input.db.prepare(
          `UPDATE products SET name=CASE WHEN revision=? THEN name ELSE NULL END,
             revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE store_id=? AND id=?`,
        ).bind(input.expectedRevision, BOOTSTRAP_STORE_ID, input.productId),
      ]);
    }
  } catch {
    try {
      await compensateNewObject(input.files, key);
    } catch {
      throw new DeliveryFileError(500, 'storage_compensation_failed', 'File storage compensation failed.', crypto.randomUUID());
    }
    const currentRevision = await readProductRevision(input.db, input.productId);
    if (currentRevision !== input.expectedRevision) {
      throw new DeliveryFileError(409, 'revision_conflict', 'The Product revision has changed.');
    }
    throw new DeliveryFileError(500, 'persistence_failed', 'The delivery file association could not be saved.', crypto.randomUUID());
  }
  const nextRevision = input.expectedRevision + 1;
  return {
    productId: input.productId,
    ...(input.variantId === null ? {} : { variantId: input.variantId }),
    file: { present: true, filename: input.filename, sizeBytes: actualSize, kind: inspected.kind },
    revision: nextRevision,
  };
}

export async function deleteDeliveryFile(input: {
  db: D1Database;
  productId: string;
  variantId: string | null;
  expectedRevision: number;
}): Promise<DeliveryFileMutationResult> {
  const revision = await readProductRevision(input.db, input.productId);
  if (revision === null) throw new DeliveryFileError(404, 'product_not_found', 'Product not found.');
  if (revision !== input.expectedRevision) throw new DeliveryFileError(409, 'revision_conflict', 'The Product revision has changed.');
  try {
    if (input.variantId === null) {
      await input.db.batch([input.db.prepare(
        `UPDATE products SET name=CASE WHEN revision=? THEN name ELSE NULL END,
           delivery_file_key=NULL, delivery_file_filename=NULL, delivery_file_size=NULL,
           delivery_file_kind=NULL, delivery_file_checksum=NULL, revision=revision+1,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE store_id=? AND id=?`,
      ).bind(input.expectedRevision, BOOTSTRAP_STORE_ID, input.productId)]);
    } else {
      const variant = await input.db.prepare(
        `SELECT id FROM product_variants
          WHERE store_id=? AND product_id=? AND id=? AND current_schema=1 AND delivery_source='variant_override'`,
      ).bind(BOOTSTRAP_STORE_ID, input.productId, input.variantId).first<{ id: string }>();
      if (!variant) throw new DeliveryFileError(404, 'variant_not_found', 'Variant not found or does not use a complete override.');
      await input.db.batch([
        input.db.prepare(
          `UPDATE product_variants SET delivery_file_key=NULL, delivery_file_filename=NULL,
             delivery_file_size=NULL, delivery_file_kind=NULL, delivery_file_checksum=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE store_id=? AND product_id=? AND id=?`,
        ).bind(BOOTSTRAP_STORE_ID, input.productId, input.variantId),
        input.db.prepare(
          `UPDATE products SET name=CASE WHEN revision=? THEN name ELSE NULL END,
             revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE store_id=? AND id=?`,
        ).bind(input.expectedRevision, BOOTSTRAP_STORE_ID, input.productId),
      ]);
    }
  } catch (error) {
    if (error instanceof DeliveryFileError) throw error;
    const currentRevision = await readProductRevision(input.db, input.productId);
    if (currentRevision !== input.expectedRevision) throw new DeliveryFileError(409, 'revision_conflict', 'The Product revision has changed.');
    throw new DeliveryFileError(500, 'persistence_failed', 'The delivery file association could not be removed.', crypto.randomUUID());
  }
  return {
    productId: input.productId,
    ...(input.variantId === null ? {} : { variantId: input.variantId }),
    file: { present: false },
    revision: input.expectedRevision + 1,
  };
}

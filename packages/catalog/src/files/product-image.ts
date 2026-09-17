import { PRODUCT_IMAGE_BYTES_MAX } from '../shared/catalog-limits';
import type { ProductImageSummary } from '../catalog-types';
import type { ConsoleIdentityContext } from '@nexus/identity/identity-types';
import { CatalogReadAccessError, readProductRevision } from '../catalog-read';
import { PUBLIC_STORE_ID } from '../public-store';

export type ProductImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export class ProductImageError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly incidentId: string | null = null,
  ) {
    super(message);
    this.name = 'ProductImageError';
  }
}

export function decodeProductImageFilename(encoded: string | null): string {
  if (encoded === null || encoded === '') {
    throw new ProductImageError(422, 'validation_failed', 'X-Nexus-Filename is required.');
  }
  let filename: string;
  try {
    filename = decodeURIComponent(encoded);
  } catch {
    throw new ProductImageError(422, 'validation_failed', 'X-Nexus-Filename is not valid percent-encoded UTF-8.');
  }
  if (filename.trim() === '' || filename.length > 255 || /[\u0000-\u001f\\]/u.test(filename)) {
    throw new ProductImageError(422, 'validation_failed', 'The product image filename is invalid.');
  }
  return filename;
}

const JPEG_PREFIX = [0xff, 0xd8, 0xff];
const PNG_PREFIX = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_PREFIX = [0x52, 0x49, 0x46, 0x46];
const WEBP_PREFIX = [0x57, 0x45, 0x42, 0x50];

function contentTypeFor(prefix: Uint8Array): ProductImageContentType | null {
  if (prefix.length >= JPEG_PREFIX.length && JPEG_PREFIX.every((value, index) => prefix[index] === value)) return 'image/jpeg';
  if (prefix.length >= PNG_PREFIX.length && PNG_PREFIX.every((value, index) => prefix[index] === value)) return 'image/png';
  if (prefix.length >= 12 && RIFF_PREFIX.every((value, index) => prefix[index] === value)
    && WEBP_PREFIX.every((value, index) => prefix[index + 8] === value)) return 'image/webp';
  return null;
}

export async function inspectAndCountProductImage(body: ReadableStream<Uint8Array> | null): Promise<{
  contentType: ProductImageContentType;
  stream: ReadableStream<Uint8Array>;
  byteCount: () => number;
  streamError: () => ProductImageError | null;
}> {
  if (body === null) throw new ProductImageError(415, 'product_image_type_invalid', 'A JPEG, PNG, or WebP body is required.');
  const reader = body.getReader();
  const initialChunks: Uint8Array[] = [];
  let prefixLength = 0;
  while (prefixLength < 12) {
    const result = await reader.read();
    if (result.done) break;
    initialChunks.push(result.value);
    prefixLength += result.value.byteLength;
  }
  const prefix = new Uint8Array(Math.min(prefixLength, 12));
  let prefixOffset = 0;
  for (const chunk of initialChunks) {
    const length = Math.min(chunk.byteLength, prefix.length - prefixOffset);
    prefix.set(chunk.subarray(0, length), prefixOffset);
    prefixOffset += length;
    if (prefixOffset === prefix.length) break;
  }
  const contentType = contentTypeFor(prefix);
  if (contentType === null) {
    await reader.cancel();
    throw new ProductImageError(415, 'product_image_type_invalid', 'Product images must contain actual JPEG, PNG, or WebP bytes.');
  }
  let count = 0;
  let initialIndex = 0;
  let failure: ProductImageError | null = null;
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
      if (count > PRODUCT_IMAGE_BYTES_MAX) {
        failure = new ProductImageError(413, 'product_image_size_exceeded', 'Product images may not exceed 5 MB.');
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
  return { contentType, stream, byteCount: () => count, streamError: () => failure };
}

async function readProductImageForStorage(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const bytes = new Uint8Array(PRODUCT_IMAGE_BYTES_MAX);
  const reader = stream.getReader();
  let offset = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) return bytes.subarray(0, offset);
    if (result.value.byteLength > bytes.byteLength - offset) {
      throw new ProductImageError(413, 'product_image_size_exceeded', 'Product images may not exceed 5 MB.');
    }
    bytes.set(result.value, offset);
    offset += result.value.byteLength;
  }
}

export interface ProductImageReference {

  key: string;
  filename: string;
  contentType: ProductImageContentType;
  sizeBytes: number;
}

function imageSummary(reference: ProductImageReference | null): ProductImageSummary {
  return reference === null
    ? { present: false }
    : { present: true, filename: reference.filename, contentType: reference.contentType, sizeBytes: reference.sizeBytes };
}

function referenceFromRow(row: {
  image_key: string | null;
  image_filename: string | null;
  image_content_type: string | null;
  image_size: number | null;
} | null): ProductImageReference | null {
  if (row === null || row.image_key === null || row.image_filename === null || row.image_size === null) return null;
  if (row.image_content_type !== 'image/jpeg' && row.image_content_type !== 'image/png' && row.image_content_type !== 'image/webp') {
    throw new Error('Product image metadata has an unsupported content type.');
  }
  return { key: row.image_key, filename: row.image_filename, contentType: row.image_content_type, sizeBytes: row.image_size };
}

async function imageReferenceForConsole(
  db: D1Database,
  identity: ConsoleIdentityContext,
  productId: string,
): Promise<ProductImageReference | null> {
  const row = await db.prepare(
    `SELECT image_key, image_filename, image_content_type, image_size
       FROM products
      WHERE store_id=? AND id=?
        AND EXISTS (SELECT 1 FROM store_memberships WHERE id=? AND store_id=? AND user_id=? AND status='active')`,
  ).bind(identity.storeId, productId, identity.membershipId, identity.storeId, identity.userId).first<{
    image_key: string | null;
    image_filename: string | null;
    image_content_type: string | null;
    image_size: number | null;
  }>();
  return referenceFromRow(row);
}

async function isCurrentOwner(db: D1Database, identity: ConsoleIdentityContext): Promise<boolean> {
  return await db.prepare(
    `SELECT EXISTS (
       SELECT 1 FROM store_memberships
        WHERE id=? AND store_id=? AND user_id=? AND role='owner' AND status='active'
     ) AS authorized`,
  ).bind(identity.membershipId, identity.storeId, identity.userId).first<number>('authorized') === 1;
}

async function isImageKeyReferenced(db: D1Database, key: string): Promise<boolean> {
  return await db.prepare('SELECT EXISTS (SELECT 1 FROM products WHERE image_key=?) AS referenced')
    .bind(key).first<number>('referenced') === 1;
}

function isGuardedRollback(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (/NOT NULL constraint failed: (?:products|stores)\.name\b/.test(current.message)) return true;
  }
  return false;
}

function commitAssertion(input: {
  db: D1Database;
  identity: ConsoleIdentityContext;
  productId: string;
  revision: number;
  key: string | null;
}): D1PreparedStatement {
  return input.db.prepare(
    `UPDATE stores SET name=CASE WHEN EXISTS (
       SELECT 1 FROM store_memberships
        WHERE id=? AND store_id=? AND user_id=? AND role='owner' AND status='active'
     ) AND EXISTS (
       SELECT 1 FROM products WHERE store_id=? AND id=? AND revision=? AND image_key IS ?
     ) THEN name ELSE NULL END
     WHERE id=?`,
  ).bind(
    input.identity.membershipId, input.identity.storeId, input.identity.userId,
    input.identity.storeId, input.productId, input.revision, input.key, input.identity.storeId,
  );
}

async function compensateNewObject(files: R2Bucket, key: string): Promise<void> {
  let failure: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await files.delete(key);
      return;
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

async function persistImageReference(input: {
  db: D1Database;
  identity: ConsoleIdentityContext;
  productId: string;
  expectedRevision: number;
  key: string | null;
  filename: string | null;
  contentType: ProductImageContentType | null;
  sizeBytes: number | null;
}): Promise<number> {
  await input.db.batch([
    input.db.prepare(
      `UPDATE products SET
         name=CASE WHEN revision=? AND EXISTS (
           SELECT 1 FROM store_memberships
            WHERE id=? AND store_id=? AND user_id=? AND role='owner' AND status='active'
         ) THEN name ELSE NULL END,
         image_key=?, image_filename=?, image_content_type=?, image_size=?,
         revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE store_id=? AND id=?`,
    ).bind(input.expectedRevision, input.identity.membershipId, input.identity.storeId, input.identity.userId,
      input.key, input.filename, input.contentType, input.sizeBytes, input.identity.storeId, input.productId),
    commitAssertion({ ...input, revision: input.expectedRevision + 1 }),
  ]);
  return input.expectedRevision + 1;
}

async function rethrowPersistFailure(input: {
  db: D1Database;
  identity: ConsoleIdentityContext;
  productId: string;
  expectedRevision: number;
  error: unknown;
  newKey: string | null;
  files: R2Bucket;
}): Promise<never> {
  if (input.newKey !== null && !await isImageKeyReferenced(input.db, input.newKey)) {
    try {
      await compensateNewObject(input.files, input.newKey);
    } catch {
      throw new ProductImageError(500, 'storage_compensation_failed', 'Product image storage compensation failed.', crypto.randomUUID());
    }
  }
  if (!await isCurrentOwner(input.db, input.identity)) throw new CatalogReadAccessError();
  const revision = await readProductRevision(input.db, input.identity, input.productId);
  if (revision !== input.expectedRevision || isGuardedRollback(input.error)) {
    throw new ProductImageError(409, 'revision_conflict', 'The Product revision has changed.');
  }
  throw new ProductImageError(500, 'persistence_failed', 'The product image association could not be saved.', crypto.randomUUID());
}

export interface ProductImageMutationResult {
  image: ProductImageSummary;
  revision: number;
}

export async function putProductImage(input: {
  db: D1Database;
  files: R2Bucket;
  identity: ConsoleIdentityContext;
  productId: string;
  expectedRevision: number;
  filename: string;
  body: ReadableStream<Uint8Array> | null;
  declaredLength: string | null;
}): Promise<ProductImageMutationResult> {
  if (input.declaredLength !== null) {
    const declared = Number(input.declaredLength);
    if (!Number.isSafeInteger(declared) || declared < 0) throw new ProductImageError(422, 'validation_failed', 'Content-Length is invalid.');
    if (declared > PRODUCT_IMAGE_BYTES_MAX) throw new ProductImageError(413, 'product_image_size_exceeded', 'Product images may not exceed 5 MB.');
  }
  const revision = await readProductRevision(input.db, input.identity, input.productId);
  if (revision === null) throw new ProductImageError(404, 'product_not_found', 'Product not found.');
  if (revision !== input.expectedRevision) throw new ProductImageError(409, 'revision_conflict', 'The Product revision has changed.');
  const previous = await imageReferenceForConsole(input.db, input.identity, input.productId);
  const inspected = await inspectAndCountProductImage(input.body);
  const key = `product-images/${crypto.randomUUID()}`;
  let object: R2Object | null;
  try {
    object = await input.files.put(key, await readProductImageForStorage(inspected.stream), {
      httpMetadata: { contentType: inspected.contentType },
    });
  } catch (error) {
    if (inspected.streamError() !== null) throw inspected.streamError();
    throw new ProductImageError(500, 'storage_write_failed', 'The product image could not be stored.', crypto.randomUUID());
  }
  const sizeBytes = inspected.byteCount();
  if (object === null || object.size !== sizeBytes || sizeBytes < 1 || sizeBytes > PRODUCT_IMAGE_BYTES_MAX) {
    try {
      await compensateNewObject(input.files, key);
    } catch {
      throw new ProductImageError(500, 'storage_compensation_failed', 'Product image storage compensation failed.', crypto.randomUUID());
    }
    throw new ProductImageError(500, 'storage_write_failed', 'The stored product image did not match the uploaded body.', crypto.randomUUID());
  }
  let nextRevision: number;
  try {
    nextRevision = await persistImageReference({
      db: input.db, identity: input.identity, productId: input.productId, expectedRevision: input.expectedRevision,
      key, filename: input.filename, contentType: inspected.contentType, sizeBytes,
    });
  } catch (error) {
    return await rethrowPersistFailure({ ...input, error, newKey: key });
  }
  if (previous !== null) {
    try {
      await compensateNewObject(input.files, previous.key);
    } catch (error) {
      console.error('Product image replacement cleanup failed', { productId: input.productId, key: previous.key, error });
    }
  }
  return { image: imageSummary({ key, filename: input.filename, contentType: inspected.contentType, sizeBytes }), revision: nextRevision };
}

export async function deleteProductImage(input: {
  db: D1Database;
  files: R2Bucket;
  identity: ConsoleIdentityContext;
  productId: string;
  expectedRevision: number;
}): Promise<ProductImageMutationResult> {
  const revision = await readProductRevision(input.db, input.identity, input.productId);
  if (revision === null) throw new ProductImageError(404, 'product_not_found', 'Product not found.');
  if (revision !== input.expectedRevision) throw new ProductImageError(409, 'revision_conflict', 'The Product revision has changed.');
  const previous = await imageReferenceForConsole(input.db, input.identity, input.productId);
  let nextRevision: number;
  try {
    nextRevision = await persistImageReference({
      db: input.db, identity: input.identity, productId: input.productId, expectedRevision: input.expectedRevision,
      key: null, filename: null, contentType: null, sizeBytes: null,
    });
  } catch (error) {
    return await rethrowPersistFailure({ ...input, error, newKey: null });
  }
  if (previous !== null) {
    try {
      await compensateNewObject(input.files, previous.key);
    } catch (error) {
      console.error('Product image removal cleanup failed', { productId: input.productId, key: previous.key, error });
    }
  }
  return { image: imageSummary(null), revision: nextRevision };
}

export async function readConsoleProductImage(
  db: D1Database,
  identity: ConsoleIdentityContext,
  productId: string,
): Promise<ProductImageReference | null> {
  const reference = await imageReferenceForConsole(db, identity, productId);
  const revision = await readProductRevision(db, identity, productId);
  if (revision === null) return null;
  return reference;
}

export async function readPublicProductImage(db: D1Database, productId: string): Promise<ProductImageReference | null> {
  const row = await db.prepare(
    `SELECT image_key, image_filename, image_content_type, image_size
       FROM products
      WHERE store_id=? AND id=? AND status='active'`,
  ).bind(PUBLIC_STORE_ID, productId).first<{
    image_key: string | null;
    image_filename: string | null;
    image_content_type: string | null;
    image_size: number | null;
  }>();
  return referenceFromRow(row);
}

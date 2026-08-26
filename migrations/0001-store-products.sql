PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  name_search_key TEXT NOT NULL DEFAULT '',
  slug_search_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  product_type TEXT NOT NULL DEFAULT 'simple' CHECK (product_type IN ('simple', 'variant')),
  currency TEXT NOT NULL DEFAULT 'USD',
  base_price_minor INTEGER NOT NULL DEFAULT 0 CHECK (base_price_minor >= 0 AND base_price_minor <= 9007199254740991),
  public_description TEXT NOT NULL DEFAULT '',
  delivery_access_title TEXT NOT NULL DEFAULT '',
  delivery_access_instructions TEXT NOT NULL DEFAULT '',
  delivery_file_key TEXT,
  delivery_file_filename TEXT,
  delivery_file_size INTEGER CHECK (delivery_file_size IS NULL OR (delivery_file_size >= 0 AND delivery_file_size <= 25000000)),
  delivery_file_kind TEXT CHECK (delivery_file_kind IS NULL OR delivery_file_kind IN ('pdf', 'zip')),
  delivery_file_checksum TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  import_fingerprint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT products_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT products_file_all_or_none CHECK (
    (delivery_file_key IS NULL AND delivery_file_filename IS NULL AND delivery_file_size IS NULL AND delivery_file_kind IS NULL AND delivery_file_checksum IS NULL)
    OR
    (delivery_file_key IS NOT NULL AND delivery_file_filename IS NOT NULL AND delivery_file_size IS NOT NULL AND delivery_file_kind IS NOT NULL AND delivery_file_checksum IS NOT NULL)
  ),
  CONSTRAINT products_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT products_store_slug_unique UNIQUE (store_id, slug)
);

CREATE INDEX IF NOT EXISTS products_store_updated_idx
  ON products (store_id, updated_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS products_store_status_updated_idx
  ON products (store_id, status, updated_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS products_store_search_idx
  ON products (store_id, name_search_key, slug_search_key);


CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 1000000),
  checksum TEXT NOT NULL,
  private_object_key TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT imports_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT imports_id_store_unique UNIQUE (id, store_id)
);

INSERT INTO stores (id, slug, name)
VALUES ('store_nexus', 'nexus', 'Nexus')
ON CONFLICT(id) DO NOTHING;

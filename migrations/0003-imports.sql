PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS imports;

CREATE TABLE imports (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 1000000),
  detected_type TEXT NOT NULL CHECK (detected_type IN ('simple', 'variant', 'mixed')),
  added_count INTEGER NOT NULL CHECK (added_count >= 0),
  duplicate_count INTEGER NOT NULL CHECK (duplicate_count >= 0),
  rejected_count INTEGER NOT NULL CHECK (rejected_count >= 0),
  private_object_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT imports_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT imports_id_store_unique UNIQUE (id, store_id)
);

CREATE INDEX imports_store_created_idx ON imports (store_id, created_at DESC, id ASC);

CREATE TRIGGER import_activate_groups_before_first_variant
BEFORE INSERT ON product_variants
WHEN substr(NEW.id, 1, 7) = 'csvvar_'
 AND EXISTS (
  SELECT 1 FROM product_option_groups
   WHERE product_id = NEW.product_id AND store_id = NEW.store_id
     AND active = 0 AND substr(id, 1, 7) = 'csvgrp_'
)
BEGIN
  UPDATE product_option_groups
     SET active = 1
   WHERE product_id = NEW.product_id AND store_id = NEW.store_id
     AND active = 0 AND substr(id, 1, 7) = 'csvgrp_';
END;

CREATE TRIGGER import_activate_enabled_variant_after_memberships
AFTER INSERT ON product_variant_values
WHEN substr(NEW.variant_id, 1, 7) = 'csvvar_'
 AND EXISTS (
  SELECT 1 FROM product_variants
   WHERE id = NEW.variant_id AND product_id = NEW.product_id AND store_id = NEW.store_id
     AND current_schema = 0 AND status = 'enabled'
)
AND (
  SELECT count(*) FROM product_variant_values WHERE variant_id = NEW.variant_id
) = (
  SELECT count(*) FROM product_option_groups
   WHERE product_id = NEW.product_id AND store_id = NEW.store_id AND active = 1 AND participating = 1
)
BEGIN
  UPDATE product_variants
     SET current_schema = 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = NEW.variant_id AND product_id = NEW.product_id AND store_id = NEW.store_id
     AND current_schema = 0 AND status = 'enabled';
END;

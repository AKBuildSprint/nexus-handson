PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS product_option_groups (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  comparison_key TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  participating INTEGER NOT NULL DEFAULT 1 CHECK (participating IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  CONSTRAINT option_groups_product_fk FOREIGN KEY (product_id, store_id) REFERENCES products(id, store_id),
  CONSTRAINT option_groups_scope_unique UNIQUE (id, product_id, store_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS option_groups_active_position_unique
  ON product_option_groups (product_id, position) WHERE active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS option_groups_active_comparison_unique
  ON product_option_groups (product_id, comparison_key) WHERE active = 1;
CREATE INDEX IF NOT EXISTS option_groups_product_idx
  ON product_option_groups (store_id, product_id, active, position);

CREATE TABLE IF NOT EXISTS product_option_values (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  label TEXT NOT NULL,
  comparison_key TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  CONSTRAINT option_values_group_fk FOREIGN KEY (group_id, product_id, store_id)
    REFERENCES product_option_groups(id, product_id, store_id),
  CONSTRAINT option_values_scope_unique UNIQUE (id, group_id, product_id, store_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS option_values_active_position_unique
  ON product_option_values (group_id, position) WHERE active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS option_values_active_comparison_unique
  ON product_option_values (group_id, comparison_key) WHERE active = 1;
CREATE INDEX IF NOT EXISTS option_values_group_idx
  ON product_option_values (store_id, product_id, group_id, active, position);

CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  combination_key TEXT NOT NULL,
  sku TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('enabled', 'disabled')),
  current_schema INTEGER NOT NULL DEFAULT 0 CHECK (current_schema IN (0, 1)),
  price_override_minor INTEGER CHECK (price_override_minor IS NULL OR (price_override_minor >= 0 AND price_override_minor <= 9007199254740991)),
  delivery_source TEXT NOT NULL DEFAULT 'product_default' CHECK (delivery_source IN ('product_default', 'variant_override')),
  delivery_access_title TEXT,
  delivery_access_instructions TEXT,
  delivery_file_key TEXT,
  delivery_file_filename TEXT,
  delivery_file_size INTEGER CHECK (delivery_file_size IS NULL OR (delivery_file_size >= 0 AND delivery_file_size <= 25000000)),
  delivery_file_kind TEXT CHECK (delivery_file_kind IS NULL OR delivery_file_kind IN ('pdf', 'zip')),
  delivery_file_checksum TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT variants_product_fk FOREIGN KEY (product_id, store_id) REFERENCES products(id, store_id),
  CONSTRAINT variants_scope_unique UNIQUE (id, product_id, store_id),
  CONSTRAINT variants_product_combination_unique UNIQUE (product_id, combination_key),
  CONSTRAINT variants_store_sku_unique UNIQUE (store_id, sku),
  CONSTRAINT variants_delivery_complete CHECK (
    (delivery_source = 'product_default' AND delivery_access_title IS NULL AND delivery_access_instructions IS NULL AND delivery_file_key IS NULL AND delivery_file_filename IS NULL AND delivery_file_size IS NULL AND delivery_file_kind IS NULL AND delivery_file_checksum IS NULL)
    OR
    (delivery_source = 'variant_override' AND delivery_access_title IS NOT NULL AND delivery_access_instructions IS NOT NULL AND (
      (delivery_file_key IS NULL AND delivery_file_filename IS NULL AND delivery_file_size IS NULL AND delivery_file_kind IS NULL AND delivery_file_checksum IS NULL)
      OR
      (delivery_file_key IS NOT NULL AND delivery_file_filename IS NOT NULL AND delivery_file_size IS NOT NULL AND delivery_file_kind IS NOT NULL AND delivery_file_checksum IS NOT NULL)
    ))
  )
);

CREATE INDEX IF NOT EXISTS variants_product_current_idx
  ON product_variants (store_id, product_id, current_schema, id);

CREATE TABLE IF NOT EXISTS product_variant_values (
  variant_id TEXT NOT NULL,
  value_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  CONSTRAINT variant_values_variant_fk FOREIGN KEY (variant_id, product_id, store_id)
    REFERENCES product_variants(id, product_id, store_id),
  CONSTRAINT variant_values_value_fk FOREIGN KEY (value_id, group_id, product_id, store_id)
    REFERENCES product_option_values(id, group_id, product_id, store_id),
  CONSTRAINT variant_values_one_group UNIQUE (variant_id, group_id),
  CONSTRAINT variant_values_identity_unique UNIQUE (variant_id, value_id),
  PRIMARY KEY (variant_id, group_id)
);

CREATE INDEX IF NOT EXISTS variant_values_product_idx
  ON product_variant_values (store_id, product_id, variant_id);

CREATE TRIGGER IF NOT EXISTS option_group_insert_requires_staging
BEFORE INSERT ON product_option_groups
WHEN NEW.active = 1
BEGIN
  SELECT RAISE(ABORT, 'matrix_incomplete');
END;

CREATE TRIGGER IF NOT EXISTS option_groups_max_five_insert
BEFORE INSERT ON product_option_groups
WHEN NEW.active = 1 AND (
  SELECT count(*) FROM product_option_groups
  WHERE product_id = NEW.product_id AND active = 1
) >= 5
BEGIN
  SELECT RAISE(ABORT, 'option_group_limit_exceeded');
END;

CREATE TRIGGER IF NOT EXISTS option_groups_max_five_activate
BEFORE UPDATE OF active ON product_option_groups
WHEN OLD.active = 0 AND NEW.active = 1 AND (
  SELECT count(*) FROM product_option_groups
  WHERE product_id = NEW.product_id AND active = 1 AND id <> NEW.id
) >= 5
BEGIN
  SELECT RAISE(ABORT, 'option_group_limit_exceeded');
END;
CREATE TRIGGER IF NOT EXISTS option_group_activation_requires_values
BEFORE UPDATE OF active ON product_option_groups
WHEN OLD.active = 0 AND NEW.active = 1 AND (
  (SELECT count(*) FROM product_option_values WHERE group_id = NEW.id AND active = 1) NOT BETWEEN 1 AND 10
)
BEGIN
  SELECT RAISE(ABORT, 'option_value_limit_exceeded');
END;


CREATE TRIGGER IF NOT EXISTS option_values_max_ten_insert
BEFORE INSERT ON product_option_values
WHEN NEW.active = 1 AND (
  SELECT count(*) FROM product_option_values
  WHERE group_id = NEW.group_id AND active = 1
) >= 10
BEGIN
  SELECT RAISE(ABORT, 'option_value_limit_exceeded');
END;

CREATE TRIGGER IF NOT EXISTS option_values_max_ten_activate
BEFORE UPDATE OF active ON product_option_values
WHEN OLD.active = 0 AND NEW.active = 1 AND (
  SELECT count(*) FROM product_option_values
  WHERE group_id = NEW.group_id AND active = 1 AND id <> NEW.id
) >= 10
BEGIN
  SELECT RAISE(ABORT, 'option_value_limit_exceeded');
END;
CREATE TRIGGER IF NOT EXISTS active_group_last_value_delete_guard
BEFORE DELETE ON product_option_values
WHEN OLD.active = 1
 AND EXISTS (SELECT 1 FROM product_option_groups WHERE id = OLD.group_id AND active = 1)
 AND (SELECT count(*) FROM product_option_values WHERE group_id = OLD.group_id AND active = 1) <= 1
BEGIN
  SELECT RAISE(ABORT, 'matrix_incomplete');
END;

CREATE TRIGGER IF NOT EXISTS active_group_last_value_deactivate_guard
BEFORE UPDATE OF active ON product_option_values
WHEN OLD.active = 1 AND NEW.active = 0
 AND EXISTS (SELECT 1 FROM product_option_groups WHERE id = OLD.group_id AND active = 1)
 AND (SELECT count(*) FROM product_option_values WHERE group_id = OLD.group_id AND active = 1) <= 1
BEGIN
  SELECT RAISE(ABORT, 'matrix_incomplete');
END;


CREATE TRIGGER IF NOT EXISTS variants_max_thirty_insert
BEFORE INSERT ON product_variants
WHEN NEW.current_schema = 1 AND (
  SELECT count(*) FROM product_variants
  WHERE product_id = NEW.product_id AND current_schema = 1
) >= 30
BEGIN
  SELECT RAISE(ABORT, 'variant_limit_exceeded');
END;

CREATE TRIGGER IF NOT EXISTS variants_max_thirty_activate
BEFORE UPDATE OF current_schema ON product_variants
WHEN OLD.current_schema = 0 AND NEW.current_schema = 1 AND (
  SELECT count(*) FROM product_variants
  WHERE product_id = NEW.product_id AND current_schema = 1 AND id <> NEW.id
) >= 30
BEGIN
  SELECT RAISE(ABORT, 'variant_limit_exceeded');
END;

CREATE TRIGGER IF NOT EXISTS enabled_variant_membership_insert
BEFORE INSERT ON product_variants
WHEN NEW.current_schema = 1 AND NEW.status = 'enabled'
BEGIN
  SELECT RAISE(ABORT, 'enabled_variant_requires_membership_setup');
END;

CREATE TRIGGER IF NOT EXISTS enabled_variant_membership_update
BEFORE UPDATE OF current_schema, status ON product_variants
WHEN NEW.current_schema = 1 AND NEW.status = 'enabled' AND (
  (SELECT count(*) FROM product_variant_values WHERE variant_id = NEW.id)
    <> (SELECT count(*) FROM product_option_groups WHERE product_id = NEW.product_id AND active = 1 AND participating = 1)
  OR EXISTS (
    SELECT 1
    FROM product_variant_values pvv
    LEFT JOIN product_option_groups pog
      ON pog.id = pvv.group_id AND pog.product_id = pvv.product_id AND pog.store_id = pvv.store_id
    LEFT JOIN product_option_values pov
      ON pov.id = pvv.value_id AND pov.group_id = pvv.group_id AND pov.product_id = pvv.product_id AND pov.store_id = pvv.store_id
    WHERE pvv.variant_id = NEW.id
      AND (pog.active <> 1 OR pog.participating <> 1 OR pov.active <> 1)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'matrix_incomplete');
END;

CREATE TRIGGER IF NOT EXISTS enabled_variant_membership_delete
BEFORE DELETE ON product_variant_values
WHEN EXISTS (
  SELECT 1 FROM product_variants
  WHERE id = OLD.variant_id AND current_schema = 1 AND status = 'enabled'
)
BEGIN
  SELECT RAISE(ABORT, 'matrix_incomplete');
END;

CREATE TRIGGER IF NOT EXISTS enabled_variant_membership_update_value
BEFORE UPDATE OF value_id, group_id, product_id, store_id ON product_variant_values
WHEN EXISTS (
  SELECT 1 FROM product_variants
  WHERE id = OLD.variant_id AND current_schema = 1 AND status = 'enabled'
)
BEGIN
  SELECT RAISE(ABORT, 'matrix_incomplete');
END;

CREATE TRIGGER IF NOT EXISTS participating_group_insert_shape_guard
BEFORE INSERT ON product_option_groups
WHEN NEW.active = 1 AND NEW.participating = 1 AND EXISTS (
  SELECT 1 FROM product_variants
   WHERE product_id = NEW.product_id AND store_id = NEW.store_id
     AND current_schema = 1 AND status = 'enabled'
)
BEGIN
  SELECT RAISE(ABORT, 'matrix_incomplete');
END;

CREATE TRIGGER IF NOT EXISTS enabled_variant_membership_insert_scope
BEFORE INSERT ON product_variant_values
WHEN EXISTS (
  SELECT 1
    FROM product_variants pv
   WHERE pv.id = NEW.variant_id AND pv.current_schema = 1 AND pv.status = 'enabled'
) AND NOT EXISTS (
  SELECT 1
    FROM product_option_groups g
    JOIN product_option_values v
      ON v.group_id = g.id AND v.product_id = g.product_id AND v.store_id = g.store_id
   WHERE g.id = NEW.group_id AND v.id = NEW.value_id
     AND g.product_id = NEW.product_id AND g.store_id = NEW.store_id
     AND g.active = 1 AND g.participating = 1 AND v.active = 1
)
BEGIN
  SELECT RAISE(ABORT, 'matrix_incomplete');
END;

CREATE TRIGGER IF NOT EXISTS active_group_shape_guard
BEFORE UPDATE OF active, participating, product_id, store_id ON product_option_groups
WHEN EXISTS (
  SELECT 1 FROM product_variants
   WHERE product_id = OLD.product_id AND store_id = OLD.store_id
     AND current_schema = 1 AND status = 'enabled'
)
BEGIN
  SELECT RAISE(ABORT, 'matrix_incomplete');
END;

CREATE TRIGGER IF NOT EXISTS active_value_shape_guard
BEFORE UPDATE OF active, group_id, product_id, store_id ON product_option_values
WHEN EXISTS (
  SELECT 1 FROM product_variant_values m
  JOIN product_variants pv ON pv.id = m.variant_id
  WHERE m.value_id = OLD.id AND pv.current_schema = 1 AND pv.status = 'enabled'
)
BEGIN
  SELECT RAISE(ABORT, 'matrix_incomplete');
END;

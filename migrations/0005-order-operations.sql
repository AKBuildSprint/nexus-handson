CREATE TABLE _s3_orders AS SELECT * FROM orders;
CREATE TABLE _s3_order_lines AS SELECT * FROM order_lines;
CREATE TABLE _s3_order_history AS SELECT * FROM order_history;
CREATE TABLE _s3_order_access AS SELECT * FROM order_access;
CREATE TABLE _s3_order_idempotency AS SELECT * FROM order_idempotency;

DROP TRIGGER orders_require_exactly_one_line;
DROP TRIGGER order_lines_prevent_delete;
DROP TRIGGER order_lines_prevent_reparent;

DROP TABLE order_idempotency;
DROP TABLE order_access;
DROP TABLE order_history;
DROP TABLE order_lines;
DROP TABLE orders;

CREATE TABLE orders (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  reference TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL CHECK (length(customer_name) BETWEEN 1 AND 120),
  customer_email_normalized TEXT NOT NULL CHECK (
    length(customer_email_normalized) BETWEEN 3 AND 254
    AND customer_email_normalized = lower(trim(customer_email_normalized))
  ),
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','completed','cancelled')),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  total_minor INTEGER NOT NULL CHECK (total_minor BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT orders_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id, store_id) REFERENCES customers(id, store_id),
  CONSTRAINT orders_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT orders_reference_store_unique UNIQUE (reference, store_id),
  CONSTRAINT orders_line_totals_unique UNIQUE (id, store_id, currency, total_minor)
);

CREATE INDEX orders_store_created_idx
  ON orders (store_id, created_at DESC, id DESC);
CREATE INDEX orders_store_customer_created_idx
  ON orders (store_id, customer_id, created_at DESC, id DESC);

INSERT INTO orders (
  id, store_id, reference, customer_id, customer_name, customer_email_normalized,
  status, currency, total_minor, created_at
)
SELECT
  id, store_id, reference, customer_id, customer_name, customer_email_normalized,
  status, currency, total_minor, created_at
FROM _s3_orders;

CREATE TRIGGER orders_require_exactly_one_line
AFTER INSERT ON orders
WHEN (
  SELECT count(*) FROM order_lines
  WHERE order_id = NEW.id AND store_id = NEW.store_id
) <> 1
BEGIN
  SELECT RAISE(ABORT, 'order_requires_exactly_one_line');
END;

CREATE TABLE order_lines (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  variant_id TEXT,
  variant_sku TEXT,
  selected_options_json TEXT NOT NULL CHECK (
    json_valid(selected_options_json) AND json_type(selected_options_json) = 'array'
  ),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor BETWEEN 0 AND 9007199254740991),
  line_total_minor INTEGER NOT NULL CHECK (
    line_total_minor BETWEEN 0 AND 9007199254740991
    AND line_total_minor = unit_price_minor * quantity
  ),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  access_title TEXT NOT NULL,
  access_instructions TEXT NOT NULL,
  private_file_key TEXT,
  CONSTRAINT order_lines_order_total_fk
    FOREIGN KEY (order_id, store_id, currency, line_total_minor)
    REFERENCES orders(id, store_id, currency, total_minor)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT order_lines_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT order_lines_exactly_one_unique UNIQUE (order_id, store_id),
  CONSTRAINT order_lines_variant_shape CHECK (
    (variant_id IS NULL AND variant_sku IS NULL)
    OR (variant_id IS NOT NULL AND variant_sku IS NOT NULL)
  )
);

INSERT INTO order_lines (
  id, store_id, order_id, product_id, product_name, variant_id, variant_sku,
  selected_options_json, quantity, unit_price_minor, line_total_minor, currency,
  access_title, access_instructions, private_file_key
)
SELECT
  id, store_id, order_id, product_id, product_name, variant_id, variant_sku,
  selected_options_json, quantity, unit_price_minor, line_total_minor, currency,
  access_title, access_instructions, private_file_key
FROM _s3_order_lines;

CREATE TRIGGER order_lines_prevent_delete
BEFORE DELETE ON order_lines
BEGIN
  SELECT RAISE(ABORT, 'order_line_required');
END;

CREATE TRIGGER order_lines_prevent_reparent
BEFORE UPDATE OF order_id, store_id ON order_lines
BEGIN
  SELECT RAISE(ABORT, 'order_line_parent_immutable');
END;

CREATE TABLE order_access (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  capability_digest TEXT NOT NULL CHECK (
    length(capability_digest) = 64
    AND capability_digest NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT order_access_order_fk FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id),
  CONSTRAINT order_access_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT order_access_one_per_order UNIQUE (order_id, store_id),
  CONSTRAINT order_access_store_capability_unique UNIQUE (store_id, capability_digest),
  CONSTRAINT order_access_order_capability_unique UNIQUE (order_id, store_id, capability_digest)
);

CREATE INDEX order_access_store_capability_idx
  ON order_access (store_id, capability_digest, order_id);

INSERT INTO order_access (
  id, store_id, order_id, capability_digest, created_at
)
SELECT
  id, store_id, order_id, capability_digest, created_at
FROM _s3_order_access;

CREATE TABLE order_idempotency (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  request_key TEXT NOT NULL CHECK (
    length(request_key) BETWEEN 16 AND 128
    AND request_key NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  order_id TEXT NOT NULL,
  capability_digest TEXT NOT NULL CHECK (
    length(capability_digest) = 64
    AND capability_digest NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT order_idempotency_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT order_idempotency_access_fk
    FOREIGN KEY (order_id, store_id, capability_digest)
    REFERENCES order_access(order_id, store_id, capability_digest),
  CONSTRAINT order_idempotency_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT order_idempotency_store_request_unique UNIQUE (store_id, request_key)
);

CREATE INDEX order_idempotency_store_key_idx
  ON order_idempotency (store_id, request_key, order_id);

INSERT INTO order_idempotency (
  id, store_id, request_key, order_id, capability_digest, created_at
)
SELECT
  id, store_id, request_key, order_id, capability_digest, created_at
FROM _s3_order_idempotency;

CREATE TABLE order_history (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_payment','completed','cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  action TEXT NOT NULL DEFAULT 'order_created',
  source TEXT NOT NULL DEFAULT 'customer_capability',
  from_status TEXT,
  CONSTRAINT order_history_order_fk FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id),
  CONSTRAINT order_history_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT order_history_id_order_store_unique UNIQUE (id, order_id, store_id),
  CONSTRAINT order_history_event_combo CHECK (
    (action = 'order_created'
      AND source = 'customer_capability'
      AND from_status IS NULL
      AND status = 'pending_payment')
    OR (action = 'order_completed'
      AND source = 'console'
      AND from_status IS NOT NULL AND from_status = 'pending_payment'
      AND status = 'completed')
    OR (action = 'order_cancelled'
      AND source = 'console'
      AND from_status IS NOT NULL AND from_status = 'pending_payment'
      AND status = 'cancelled')
    OR (action = 'refund_requested'
      AND source = 'customer_capability'
      AND from_status IS NOT NULL AND from_status = 'completed'
      AND status = 'completed')
  )
);

CREATE INDEX order_history_order_created_idx
  ON order_history (store_id, order_id, created_at, id);

CREATE UNIQUE INDEX order_history_terminal_action_unique
  ON order_history (store_id, order_id)
  WHERE action IN ('order_completed', 'order_cancelled');

CREATE UNIQUE INDEX order_history_refund_requested_unique
  ON order_history (store_id, order_id)
  WHERE action = 'refund_requested';

INSERT INTO order_history (
  id, store_id, order_id, status, created_at, action, source, from_status
)
SELECT
  id, store_id, order_id, status, created_at,
  'order_created', 'customer_capability', NULL
FROM _s3_order_history;

CREATE TABLE order_refund_requests (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status = 'pending'),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT order_refund_requests_order_fk FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id),
  CONSTRAINT order_refund_requests_one_per_order UNIQUE (order_id, store_id),
  CONSTRAINT order_refund_requests_id_store_unique UNIQUE (id, store_id)
);

CREATE TABLE order_commands (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  request_key TEXT NOT NULL CHECK (
    length(request_key) BETWEEN 16 AND 128
    AND request_key NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  order_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('complete', 'cancel', 'request_refund')),
  payload_hash TEXT NOT NULL CHECK (
    length(payload_hash) = 64
    AND payload_hash NOT GLOB '*[^0-9a-f]*'
  ),
  result_history_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT order_commands_order_fk FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id),
  CONSTRAINT order_commands_history_fk FOREIGN KEY (result_history_id, order_id, store_id) REFERENCES order_history(id, order_id, store_id),
  CONSTRAINT order_commands_store_request_unique UNIQUE (store_id, request_key)
);

DROP TABLE _s3_order_idempotency;
DROP TABLE _s3_order_access;
DROP TABLE _s3_order_history;
DROP TABLE _s3_order_lines;
DROP TABLE _s3_orders;

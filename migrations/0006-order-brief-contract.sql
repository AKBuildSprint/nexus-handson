CREATE TABLE _s6_orders AS SELECT * FROM orders;
CREATE TABLE _s6_order_lines AS SELECT * FROM order_lines;
CREATE TABLE _s6_order_history AS SELECT * FROM order_history;
CREATE TABLE _s6_order_access AS SELECT * FROM order_access;
CREATE TABLE _s6_order_idempotency AS SELECT * FROM order_idempotency;
CREATE TABLE _s6_order_refund_requests AS SELECT * FROM order_refund_requests;
CREATE TABLE _s6_order_commands AS SELECT * FROM order_commands;

DROP TRIGGER orders_require_exactly_one_line;
DROP TRIGGER order_lines_prevent_delete;
DROP TRIGGER order_lines_prevent_reparent;

DROP TABLE order_commands;
DROP TABLE order_history;
DROP TABLE order_refund_requests;
DROP TABLE order_idempotency;
DROP TABLE order_access;
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
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','fulfilled','canceled')),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  total_minor INTEGER NOT NULL CHECK (total_minor BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  payment_reference TEXT NOT NULL DEFAULT ('NP' || lower(hex(randomblob(16)))) CHECK (
    length(payment_reference) BETWEEN 3 AND 80
    AND payment_reference GLOB 'NP*'
  ),
  CONSTRAINT orders_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id, store_id) REFERENCES customers(id, store_id),
  CONSTRAINT orders_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT orders_reference_store_unique UNIQUE (reference, store_id),
  CONSTRAINT orders_payment_reference_unique UNIQUE (payment_reference),
  CONSTRAINT orders_currency_tuple_unique UNIQUE (id, store_id, currency),
  CONSTRAINT orders_money_tuple_unique UNIQUE (id, store_id, currency, total_minor)
);

INSERT INTO orders (
  id, store_id, reference, customer_id, customer_name, customer_email_normalized,
  status, currency, total_minor, created_at, payment_reference
)
SELECT
  id, store_id, reference, customer_id, customer_name, customer_email_normalized,
  CASE status
    WHEN 'pending_payment' THEN 'pending'
    WHEN 'completed' THEN 'paid'
    WHEN 'cancelled' THEN 'canceled'
    ELSE status
  END,
  currency, total_minor, created_at,
  'NP' || lower(hex(randomblob(16)))
FROM _s6_orders;

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
  position INTEGER NOT NULL CHECK (position >= 0),
  CONSTRAINT order_lines_order_currency_fk
    FOREIGN KEY (order_id, store_id, currency)
    REFERENCES orders(id, store_id, currency)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT order_lines_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT order_lines_position_unique UNIQUE (order_id, store_id, position),
  CONSTRAINT order_lines_variant_shape CHECK (
    (variant_id IS NULL AND variant_sku IS NULL)
    OR (variant_id IS NOT NULL AND variant_sku IS NOT NULL)
  )
);

INSERT INTO order_lines (
  id, store_id, order_id, product_id, product_name, variant_id, variant_sku,
  selected_options_json, quantity, unit_price_minor, line_total_minor, currency,
  access_title, access_instructions, private_file_key, position
)
SELECT
  id, store_id, order_id, product_id, product_name, variant_id, variant_sku,
  selected_options_json, quantity, unit_price_minor, line_total_minor, currency,
  access_title, access_instructions, private_file_key, 0
FROM _s6_order_lines;

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

INSERT INTO order_access (
  id, store_id, order_id, capability_digest, created_at
)
SELECT
  id, store_id, order_id, capability_digest, created_at
FROM _s6_order_access;

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

INSERT INTO order_idempotency (
  id, store_id, request_key, order_id, capability_digest, created_at
)
SELECT
  id, store_id, request_key, order_id, capability_digest, created_at
FROM _s6_order_idempotency;

CREATE TABLE order_refund_requests (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status = 'pending'),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor_source TEXT NOT NULL CHECK (actor_source IN ('storefront','bootstrap_owner','user','system')),
  actor_id TEXT,
  CONSTRAINT order_refund_requests_order_fk FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id),
  CONSTRAINT order_refund_requests_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT order_refund_requests_id_order_store_unique UNIQUE (id, order_id, store_id)
);

INSERT INTO order_refund_requests (
  id, store_id, order_id, status, reason, created_at, actor_source, actor_id
)
SELECT
  id, store_id, order_id, status, reason, created_at, 'storefront', NULL
FROM _s6_order_refund_requests;

CREATE UNIQUE INDEX order_refund_requests_one_open
  ON order_refund_requests (store_id, order_id)
  WHERE status = 'pending';

CREATE TABLE order_history (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','paid','fulfilled','canceled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  action TEXT NOT NULL,
  source TEXT NOT NULL,
  from_status TEXT,
  actor_id TEXT,
  contract_version INTEGER NOT NULL DEFAULT 2 CHECK (contract_version IN (1, 2)),
  refund_request_id TEXT,
  CONSTRAINT order_history_order_fk FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id),
  CONSTRAINT order_history_refund_fk
    FOREIGN KEY (refund_request_id, order_id, store_id)
    REFERENCES order_refund_requests(id, order_id, store_id),
  CONSTRAINT order_history_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT order_history_id_order_store_unique UNIQUE (id, order_id, store_id),
  CONSTRAINT order_history_event_combo CHECK (
    (
      contract_version = 1
      AND actor_id IS NULL
      AND (
        (action = 'order_created'
          AND source = 'customer_capability'
          AND from_status IS NULL
          AND status = 'pending'
          AND refund_request_id IS NULL)
        OR (action = 'order_completed'
          AND source = 'console'
          AND from_status IS 'pending'
          AND status = 'paid'
          AND refund_request_id IS NULL)
        OR (action = 'order_cancelled'
          AND source = 'console'
          AND from_status IS 'pending'
          AND status = 'canceled'
          AND refund_request_id IS NULL)
        OR (action = 'refund_requested'
          AND source = 'customer_capability'
          AND from_status IS 'paid'
          AND status = 'paid'
          AND refund_request_id IS NOT NULL)
      )
    )
    OR (
      contract_version = 2
      AND (
        (action = 'order_created'
          AND source IN ('storefront','user','system')
          AND from_status IS NULL
          AND status = 'pending'
          AND refund_request_id IS NULL)
        OR (action = 'order_paid'
          AND source IN ('bootstrap_owner','user','system')
          AND from_status IS 'pending'
          AND status = 'paid'
          AND refund_request_id IS NULL)
        OR (action = 'order_fulfilled'
          AND source IN ('bootstrap_owner','user','system')
          AND from_status IS 'paid'
          AND status = 'fulfilled'
          AND refund_request_id IS NULL)
        OR (action = 'order_canceled'
          AND source IN ('bootstrap_owner','user','system')
          AND from_status IS 'pending'
          AND status = 'canceled'
          AND refund_request_id IS NULL)
        OR (action = 'refund_requested'
          AND source IN ('storefront','bootstrap_owner','user','system')
          AND from_status IN ('paid','fulfilled')
          AND from_status IS NOT NULL
          AND status IS from_status
          AND refund_request_id IS NOT NULL)
      )
    )
  )
);

CREATE UNIQUE INDEX order_history_decision_unique
  ON order_history (store_id, order_id)
  WHERE action IN ('order_paid','order_canceled','order_completed','order_cancelled');

CREATE UNIQUE INDEX order_history_fulfilled_unique
  ON order_history (store_id, order_id)
  WHERE action = 'order_fulfilled';

CREATE UNIQUE INDEX order_history_refund_event_unique
  ON order_history (store_id, order_id, refund_request_id)
  WHERE action = 'refund_requested' AND refund_request_id IS NOT NULL;

INSERT INTO order_history (
  id, store_id, order_id, status, created_at, action, source, from_status,
  actor_id, contract_version, refund_request_id
)
SELECT
  h.id,
  h.store_id,
  h.order_id,
  CASE h.status
    WHEN 'pending_payment' THEN 'pending'
    WHEN 'completed' THEN 'paid'
    WHEN 'cancelled' THEN 'canceled'
    ELSE h.status
  END,
  h.created_at,
  h.action,
  h.source,
  CASE h.from_status
    WHEN 'pending_payment' THEN 'pending'
    WHEN 'completed' THEN 'paid'
    WHEN 'cancelled' THEN 'canceled'
    ELSE h.from_status
  END,
  NULL,
  1,
  CASE
    WHEN h.action = 'refund_requested' THEN (
      SELECT r.id FROM _s6_order_refund_requests r
      WHERE r.store_id = h.store_id AND r.order_id = h.order_id
    )
    ELSE NULL
  END
FROM _s6_order_history h;

CREATE TABLE order_commands (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  request_key TEXT NOT NULL CHECK (
    length(request_key) BETWEEN 16 AND 128
    AND request_key NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  order_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (
    length(payload_hash) = 64
    AND payload_hash NOT GLOB '*[^0-9a-f]*'
  ),
  result_history_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  contract_version INTEGER NOT NULL DEFAULT 2,
  result_refund_request_id TEXT,
  CONSTRAINT order_commands_version_action CHECK (
    (contract_version = 1 AND action IN ('complete','cancel','request_refund'))
    OR (contract_version = 2 AND action IN ('mark_paid','fulfill','cancel','request_refund'))
  ),
  CONSTRAINT order_commands_order_fk FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id),
  CONSTRAINT order_commands_history_fk
    FOREIGN KEY (result_history_id, order_id, store_id)
    REFERENCES order_history(id, order_id, store_id),
  CONSTRAINT order_commands_refund_fk
    FOREIGN KEY (result_refund_request_id, order_id, store_id)
    REFERENCES order_refund_requests(id, order_id, store_id),
  CONSTRAINT order_commands_store_request_unique UNIQUE (store_id, request_key)
);

INSERT INTO order_commands (
  id, store_id, request_key, order_id, action, payload_hash, result_history_id, created_at,
  contract_version, result_refund_request_id
)
SELECT
  c.id, c.store_id, c.request_key, c.order_id, c.action, c.payload_hash, c.result_history_id, c.created_at,
  1,
  CASE
    WHEN c.action = 'request_refund' THEN (
      SELECT r.id FROM _s6_order_refund_requests r
      WHERE r.store_id = c.store_id AND r.order_id = c.order_id
    )
    ELSE NULL
  END
FROM _s6_order_commands c;

CREATE TRIGGER orders_require_line_aggregate
AFTER INSERT ON orders
WHEN (
  SELECT count(*) FROM order_lines
  WHERE order_id = NEW.id AND store_id = NEW.store_id
) NOT BETWEEN 1 AND 10
OR (
  SELECT COALESCE(sum(line_total_minor), 0) FROM order_lines
  WHERE order_id = NEW.id AND store_id = NEW.store_id
) != NEW.total_minor
OR EXISTS (
  SELECT 1 FROM order_lines
  WHERE order_id = NEW.id AND store_id = NEW.store_id AND currency != NEW.currency
)
BEGIN
  SELECT RAISE(ABORT, 'order_lines_aggregate_invalid');
END;

CREATE TRIGGER order_lines_prevent_insert_after_parent
BEFORE INSERT ON order_lines
WHEN EXISTS (
  SELECT 1 FROM orders WHERE id = NEW.order_id AND store_id = NEW.store_id
)
BEGIN
  SELECT RAISE(ABORT, 'order_line_frozen');
END;

CREATE TRIGGER order_lines_prevent_delete
BEFORE DELETE ON order_lines
BEGIN
  SELECT RAISE(ABORT, 'order_line_immutable');
END;

CREATE TRIGGER order_lines_prevent_mutation
BEFORE UPDATE ON order_lines
BEGIN
  SELECT RAISE(ABORT, 'order_line_immutable');
END;

CREATE TRIGGER orders_prevent_money_update
BEFORE UPDATE OF currency, total_minor, payment_reference ON orders
BEGIN
  SELECT RAISE(ABORT, 'order_money_immutable');
END;

DROP TABLE _s6_order_commands;
DROP TABLE _s6_order_history;
DROP TABLE _s6_order_refund_requests;
DROP TABLE _s6_order_idempotency;
DROP TABLE _s6_order_access;
DROP TABLE _s6_order_lines;
DROP TABLE _s6_orders;

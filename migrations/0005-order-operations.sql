CREATE TABLE _s2_history_cardinality_guard (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO _s2_history_cardinality_guard (ok)
SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM orders AS o
    WHERE (
      SELECT count(*) FROM order_history AS h
      WHERE h.order_id = o.id AND h.store_id = o.store_id
    ) <> 1
  ) THEN 0 ELSE 1
END;
DROP TABLE _s2_history_cardinality_guard;

CREATE TABLE orders_s3 (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  reference TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL CHECK (length(customer_name) BETWEEN 1 AND 120),
  customer_email_normalized TEXT NOT NULL CHECK (
    length(customer_email_normalized) BETWEEN 3 AND 254
    AND customer_email_normalized = lower(trim(customer_email_normalized))
  ),
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'paid', 'fulfilled', 'cancelled')),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  total_minor INTEGER NOT NULL CHECK (total_minor BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT orders_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id, store_id) REFERENCES customers(id, store_id),
  CONSTRAINT orders_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT orders_reference_store_unique UNIQUE (reference, store_id),
  CONSTRAINT orders_line_totals_unique UNIQUE (id, store_id, currency, total_minor)
);
INSERT INTO orders_s3 SELECT * FROM orders;

CREATE TABLE order_lines_s3 (
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
    REFERENCES orders_s3(id, store_id, currency, total_minor)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT order_lines_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT order_lines_exactly_one_unique UNIQUE (order_id, store_id),
  CONSTRAINT order_lines_variant_shape CHECK (
    (variant_id IS NULL AND variant_sku IS NULL)
    OR (variant_id IS NOT NULL AND variant_sku IS NOT NULL)
  )
);
INSERT INTO order_lines_s3 SELECT * FROM order_lines;

CREATE TABLE order_access_s3 (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  capability_digest TEXT NOT NULL CHECK (
    length(capability_digest) = 64
    AND capability_digest NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT order_access_order_fk FOREIGN KEY (order_id, store_id) REFERENCES orders_s3(id, store_id),
  CONSTRAINT order_access_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT order_access_one_per_order UNIQUE (order_id, store_id),
  CONSTRAINT order_access_store_capability_unique UNIQUE (store_id, capability_digest),
  CONSTRAINT order_access_order_capability_unique UNIQUE (order_id, store_id, capability_digest)
);
INSERT INTO order_access_s3 SELECT * FROM order_access;

CREATE TABLE order_idempotency_s3 (
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
    REFERENCES order_access_s3(order_id, store_id, capability_digest),
  CONSTRAINT order_idempotency_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT order_idempotency_store_request_unique UNIQUE (store_id, request_key)
);
INSERT INTO order_idempotency_s3 SELECT * FROM order_idempotency;

CREATE TABLE refund_requests (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (
    length(reason) BETWEEN 1 AND 1000
    AND instr(reason, char(0)) = 0
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status = 'pending'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT refund_requests_order_fk FOREIGN KEY (order_id, store_id) REFERENCES orders_s3(id, store_id),
  CONSTRAINT refund_requests_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT refund_requests_id_store_order_unique UNIQUE (id, store_id, order_id),
  CONSTRAINT refund_requests_one_per_order UNIQUE (order_id, store_id)
);

CREATE TABLE order_history_s3 (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  action TEXT NOT NULL CHECK (action IN ('order_created', 'mark_paid', 'mark_fulfilled', 'cancel', 'refund_requested')),
  previous_status TEXT CHECK (
    previous_status IS NULL OR previous_status IN ('pending_payment', 'paid', 'fulfilled', 'cancelled')
  ),
  status TEXT NOT NULL CHECK (status IN ('pending_payment', 'paid', 'fulfilled', 'cancelled')),
  source TEXT NOT NULL CHECK (source IN ('storefront', 'console')),
  refund_request_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT order_history_order_fk FOREIGN KEY (order_id, store_id) REFERENCES orders_s3(id, store_id),
  CONSTRAINT order_history_refund_fk
    FOREIGN KEY (refund_request_id, store_id, order_id)
    REFERENCES refund_requests(id, store_id, order_id),
  CONSTRAINT order_history_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT order_history_id_store_order_unique UNIQUE (id, store_id, order_id),
  CONSTRAINT order_history_sequence_unique UNIQUE (store_id, order_id, sequence),
  CONSTRAINT order_history_event_shape CHECK (
    (
      action = 'order_created'
      AND previous_status IS NULL
      AND status = 'pending_payment'
      AND source = 'storefront'
      AND refund_request_id IS NULL
    )
    OR (
      action = 'mark_paid'
      AND previous_status IS NOT NULL
      AND previous_status = 'pending_payment'
      AND status = 'paid'
      AND source = 'console'
      AND refund_request_id IS NULL
    )
    OR (
      action = 'cancel'
      AND previous_status IS NOT NULL
      AND previous_status = 'pending_payment'
      AND status = 'cancelled'
      AND source = 'console'
      AND refund_request_id IS NULL
    )
    OR (
      action = 'mark_fulfilled'
      AND previous_status IS NOT NULL
      AND previous_status = 'paid'
      AND status = 'fulfilled'
      AND source = 'console'
    )
    OR (
      action = 'refund_requested'
      AND previous_status IS NOT NULL
      AND previous_status = status
      AND status IN ('paid', 'fulfilled')
      AND source = 'storefront'
      AND refund_request_id IS NOT NULL
    )
  )
);
INSERT INTO order_history_s3 (
  id, store_id, order_id, sequence, action, previous_status, status, source, refund_request_id, created_at
)
SELECT
  id, store_id, order_id, 0, 'order_created', NULL, 'pending_payment', 'storefront', NULL, created_at
FROM order_history;

DROP TABLE order_idempotency;
DROP TABLE order_access;
DROP TABLE order_history;
DROP TABLE order_lines;
DROP TABLE orders;

ALTER TABLE orders_s3 RENAME TO orders;
ALTER TABLE order_lines_s3 RENAME TO order_lines;
ALTER TABLE order_access_s3 RENAME TO order_access;
ALTER TABLE order_idempotency_s3 RENAME TO order_idempotency;
ALTER TABLE order_history_s3 RENAME TO order_history;

CREATE INDEX orders_store_created_idx
  ON orders (store_id, created_at DESC, id DESC);
CREATE INDEX orders_store_customer_created_idx
  ON orders (store_id, customer_id, created_at DESC, id DESC);
CREATE INDEX orders_store_status_created_idx
  ON orders (store_id, status, created_at DESC, id DESC);
CREATE INDEX order_history_order_created_idx
  ON order_history (store_id, order_id, created_at, id);
CREATE INDEX order_access_store_capability_idx
  ON order_access (store_id, capability_digest, order_id);
CREATE INDEX order_idempotency_store_key_idx
  ON order_idempotency (store_id, request_key, order_id);

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

CREATE TRIGGER orders_require_exactly_one_line
AFTER INSERT ON orders
WHEN (
  SELECT count(*) FROM order_lines
  WHERE order_id = NEW.id AND store_id = NEW.store_id
) <> 1
BEGIN
  SELECT RAISE(ABORT, 'order_requires_exactly_one_line');
END;

CREATE TRIGGER orders_status_transition
BEFORE UPDATE OF status ON orders
WHEN NOT (
  (OLD.status = 'pending_payment' AND NEW.status = 'paid')
  OR (OLD.status = 'pending_payment' AND NEW.status = 'cancelled')
  OR (OLD.status = 'paid' AND NEW.status = 'fulfilled')
)
BEGIN
  SELECT RAISE(ABORT, 'order_status_transition');
END;

CREATE TABLE order_commands (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  request_key TEXT NOT NULL CHECK (
    length(request_key) BETWEEN 16 AND 128
    AND request_key NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  order_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('mark_paid', 'mark_fulfilled', 'cancel', 'request_refund')),
  payload_digest TEXT NOT NULL CHECK (
    length(payload_digest) = 64
    AND payload_digest NOT GLOB '*[^0-9a-f]*'
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'already_applied')),
  result_status TEXT NOT NULL CHECK (result_status IN ('pending_payment', 'paid', 'fulfilled', 'cancelled')),
  history_id TEXT,
  refund_request_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT order_commands_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT order_commands_order_fk FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id),
  CONSTRAINT order_commands_history_fk
    FOREIGN KEY (history_id, store_id, order_id)
    REFERENCES order_history(id, store_id, order_id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT order_commands_refund_fk
    FOREIGN KEY (refund_request_id, store_id, order_id)
    REFERENCES refund_requests(id, store_id, order_id),
  CONSTRAINT order_commands_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT order_commands_store_request_unique UNIQUE (store_id, request_key),
  CONSTRAINT order_commands_history_presence CHECK (
    (outcome = 'applied' AND history_id IS NOT NULL)
    OR (outcome = 'already_applied' AND history_id IS NULL)
  ),
  CONSTRAINT order_commands_already_applied_shape CHECK (
    outcome = 'applied'
    OR (action = 'mark_paid' AND result_status = 'paid')
    OR (action = 'request_refund' AND result_status IN ('paid', 'fulfilled'))
  ),
  CONSTRAINT order_commands_applied_result CHECK (
    outcome = 'already_applied'
    OR (action = 'mark_paid' AND result_status = 'paid')
    OR (action = 'mark_fulfilled' AND result_status = 'fulfilled')
    OR (action = 'cancel' AND result_status = 'cancelled')
    OR (action = 'request_refund' AND result_status IN ('paid', 'fulfilled'))
  ),
  CONSTRAINT order_commands_refund_link CHECK (
    (action = 'request_refund' AND refund_request_id IS NOT NULL)
    OR (action IN ('mark_paid', 'cancel') AND refund_request_id IS NULL)
    OR action = 'mark_fulfilled'
  )
);
CREATE INDEX order_commands_store_key_idx
  ON order_commands (store_id, request_key, order_id);

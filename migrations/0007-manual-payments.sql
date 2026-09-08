CREATE TABLE payments (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source = 'manual'),
  method TEXT NOT NULL CHECK (
    length(method) BETWEEN 1 AND 80
    AND method = trim(method)
  ),
  external_reference TEXT NOT NULL CHECK (
    length(external_reference) BETWEEN 1 AND 160
    AND external_reference = trim(external_reference)
  ),
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 0 AND 9007199254740991),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  status TEXT NOT NULL CHECK (status = 'succeeded'),
  history_id TEXT NOT NULL,
  recorded_actor_source TEXT NOT NULL CHECK (
    recorded_actor_source IN ('bootstrap_owner','storefront','user','system')
  ),
  recorded_actor_id TEXT,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT payments_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT payments_order_money_fk
    FOREIGN KEY (order_id, store_id, currency, amount_minor)
    REFERENCES orders(id, store_id, currency, total_minor),
  CONSTRAINT payments_history_order_fk
    FOREIGN KEY (history_id, order_id, store_id)
    REFERENCES order_history(id, order_id, store_id),
  CONSTRAINT payments_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT payments_succeeded_order_unique UNIQUE (store_id, order_id),
  CONSTRAINT payments_external_reference_unique UNIQUE (store_id, source, external_reference),
  CONSTRAINT payments_history_unique UNIQUE (history_id),
  CONSTRAINT payments_history_order_unique UNIQUE (history_id, order_id, store_id)
);

CREATE INDEX orders_store_created_idx
  ON orders (store_id, created_at DESC, id DESC);
CREATE INDEX orders_store_customer_created_idx
  ON orders (store_id, customer_id, created_at DESC, id DESC);
CREATE INDEX orders_store_status_created_idx
  ON orders (store_id, status, created_at DESC, id DESC);
CREATE INDEX order_access_store_capability_idx
  ON order_access (store_id, capability_digest, order_id);
CREATE INDEX order_idempotency_store_key_idx
  ON order_idempotency (store_id, request_key, order_id);
CREATE INDEX order_history_order_created_idx
  ON order_history (store_id, order_id, created_at, id);
CREATE INDEX order_refund_requests_order_idx
  ON order_refund_requests (store_id, order_id, created_at, id);
CREATE INDEX payments_store_order_idx
  ON payments (store_id, order_id, recorded_at, id);
CREATE INDEX payments_store_external_idx
  ON payments (store_id, external_reference);

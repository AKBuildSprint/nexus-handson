CREATE TABLE provider_events (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 80 AND id = trim(id)),
  type TEXT NOT NULL CHECK (type IN ('payment', 'logistics')),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 80 AND provider = trim(provider)),
  provider_event_id TEXT NOT NULL CHECK (
    length(provider_event_id) BETWEEN 1 AND 160
    AND provider_event_id = trim(provider_event_id)
  ),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  store_id TEXT,
  order_id TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT provider_events_order_shape CHECK (
    (store_id IS NULL AND order_id IS NULL)
    OR (store_id IS NOT NULL AND order_id IS NOT NULL)
  ),
  CONSTRAINT provider_events_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT provider_events_order_fk FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id),
  CONSTRAINT provider_events_provider_event_unique UNIQUE (provider, provider_event_id),
  CONSTRAINT provider_events_id_provider_unique UNIQUE (id, provider)
);

CREATE INDEX provider_events_store_order_received_idx
  ON provider_events (store_id, order_id, received_at, id)
  WHERE store_id IS NOT NULL AND order_id IS NOT NULL;

CREATE TABLE provider_payments (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 80 AND id = trim(id)),
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  gateway TEXT NOT NULL CHECK (length(gateway) BETWEEN 1 AND 80 AND gateway = trim(gateway)),
  provider_transaction_id TEXT NOT NULL CHECK (
    length(provider_transaction_id) BETWEEN 1 AND 160
    AND provider_transaction_id = trim(provider_transaction_id)
  ),
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 0 AND 9007199254740991),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  status TEXT NOT NULL CHECK (status = 'succeeded'),
  event_id TEXT NOT NULL,
  history_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT provider_payments_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT provider_payments_order_money_fk
    FOREIGN KEY (order_id, store_id, currency, amount_minor)
    REFERENCES orders(id, store_id, currency, total_minor),
  CONSTRAINT provider_payments_history_order_fk
    FOREIGN KEY (history_id, order_id, store_id)
    REFERENCES order_history(id, order_id, store_id),
  CONSTRAINT provider_payments_event_provider_fk
    FOREIGN KEY (event_id, gateway)
    REFERENCES provider_events(id, provider),
  CONSTRAINT provider_payments_gateway_transaction_unique UNIQUE (gateway, provider_transaction_id),
  CONSTRAINT provider_payments_succeeded_order_unique UNIQUE (store_id, order_id),
  CONSTRAINT provider_payments_history_unique UNIQUE (history_id),
  CONSTRAINT provider_payments_history_order_unique UNIQUE (history_id, order_id, store_id)
);

CREATE INDEX provider_payments_store_order_idx
  ON provider_payments (store_id, order_id, recorded_at, id);
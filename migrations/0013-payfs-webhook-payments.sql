CREATE TABLE payfs_payment_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  transaction_id TEXT NOT NULL UNIQUE CHECK (
    length(transaction_id) BETWEEN 1 AND 128
    AND transaction_id = trim(transaction_id)
    AND transaction_id NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  facts_fingerprint TEXT NOT NULL CHECK (
    length(facts_fingerprint) = 64
    AND facts_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('confirmed', 'ignored')),
  ignored_reason TEXT CHECK (
    ignored_reason IS NULL
    OR ignored_reason IN ('not_credit', 'recipient_mismatch', 'reference_missing', 'reference_ambiguous', 'order_not_eligible')
  ),
  store_id TEXT,
  order_id TEXT,
  history_id TEXT,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT payfs_receipt_terminal_shape CHECK (
    (outcome = 'confirmed' AND ignored_reason IS NULL AND store_id IS NOT NULL AND order_id IS NOT NULL AND history_id IS NOT NULL)
    OR (outcome = 'ignored' AND ignored_reason IS NOT NULL AND store_id IS NULL AND order_id IS NULL AND history_id IS NULL)
  ),
  CONSTRAINT payfs_receipt_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT payfs_receipt_order_fk FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id),
  CONSTRAINT payfs_receipt_history_fk
    FOREIGN KEY (history_id, order_id, store_id)
    REFERENCES order_history(id, order_id, store_id),
  CONSTRAINT payfs_receipt_confirmed_order_unique UNIQUE (store_id, order_id),
  CONSTRAINT payfs_receipt_confirmed_history_unique UNIQUE (history_id)
);

CREATE INDEX payfs_payment_receipts_confirmed_order_idx
  ON payfs_payment_receipts (store_id, order_id)
  WHERE outcome = 'confirmed';

CREATE TABLE order_email_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('order_created', 'payment_confirmed', 'payment_reminder')),
  reminder_sequence INTEGER CHECK (
    reminder_sequence IS NULL OR reminder_sequence BETWEEN 1 AND 6
  ),
  available_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 12),
  delivered_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT order_email_job_shape CHECK (
    (kind = 'payment_reminder' AND reminder_sequence IS NOT NULL)
    OR (kind != 'payment_reminder' AND reminder_sequence IS NULL)
  ),
  CONSTRAINT order_email_job_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT order_email_job_order_fk FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id)
);

CREATE UNIQUE INDEX order_email_jobs_one_event_idx
  ON order_email_jobs (store_id, order_id, kind)
  WHERE reminder_sequence IS NULL;

CREATE UNIQUE INDEX order_email_jobs_one_reminder_idx
  ON order_email_jobs (store_id, order_id, kind, reminder_sequence)
  WHERE reminder_sequence IS NOT NULL;

CREATE INDEX order_email_jobs_due_idx
  ON order_email_jobs (available_at, created_at)
  WHERE delivered_at IS NULL;

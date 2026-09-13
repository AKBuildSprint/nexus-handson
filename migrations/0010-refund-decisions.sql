CREATE TABLE _s4_refund_requests AS SELECT * FROM order_refund_requests;
CREATE TABLE _s4_refund_history AS SELECT * FROM order_history;
CREATE TABLE _s4_refund_commands AS SELECT * FROM order_commands;
CREATE TABLE _s4_refund_payments AS SELECT * FROM payments;
CREATE TABLE _s4_refund_assignments AS SELECT * FROM order_assignments;

DROP TABLE order_assignments;
DROP TABLE order_commands;
DROP TABLE payments;
DROP TABLE order_history;
DROP TABLE order_refund_requests;

CREATE TABLE order_refund_requests (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor_source TEXT NOT NULL CHECK (actor_source IN ('storefront','bootstrap_owner','user','system')),
  actor_id TEXT,
  decided_at TEXT,
  decided_by_user_id TEXT,
  CONSTRAINT order_refund_requests_order_fk
    FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id),
  CONSTRAINT order_refund_requests_decider_membership_fk
    FOREIGN KEY (decided_by_user_id, store_id) REFERENCES store_memberships(user_id, store_id),
  CONSTRAINT order_refund_requests_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT order_refund_requests_id_order_store_unique UNIQUE (id, order_id, store_id),
  CONSTRAINT order_refund_requests_order_unique UNIQUE (store_id, order_id),
  CONSTRAINT order_refund_requests_decision_shape CHECK (
    (status = 'pending' AND decided_at IS NULL AND decided_by_user_id IS NULL)
    OR (status IN ('approved','rejected') AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL)
  )
);

CREATE INDEX order_refund_requests_order_idx
  ON order_refund_requests (store_id, order_id, created_at, id);

INSERT INTO order_refund_requests (
  id, store_id, order_id, status, reason, created_at, actor_source, actor_id,
  decided_at, decided_by_user_id
)
SELECT
  id, store_id, order_id, status, reason, created_at, actor_source, actor_id,
  NULL, NULL
FROM _s4_refund_requests;

CREATE TRIGGER order_refund_requests_terminal_immutable
BEFORE UPDATE ON order_refund_requests
WHEN OLD.status IN ('approved','rejected')
BEGIN
  SELECT RAISE(ABORT, 'refund_decision_is_final');
END;

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
  assignee_user_id TEXT,
  CONSTRAINT order_history_order_fk FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id),
  CONSTRAINT order_history_refund_fk
    FOREIGN KEY (refund_request_id, order_id, store_id)
    REFERENCES order_refund_requests(id, order_id, store_id),
  CONSTRAINT order_history_assignee_membership_fk
    FOREIGN KEY (assignee_user_id, store_id) REFERENCES store_memberships(user_id, store_id),
  CONSTRAINT order_history_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT order_history_id_order_store_unique UNIQUE (id, order_id, store_id),
  CONSTRAINT order_history_event_combo CHECK (
    (
      contract_version = 1
      AND actor_id IS NULL
      AND assignee_user_id IS NULL
      AND (
        (action = 'order_created' AND source = 'customer_capability' AND from_status IS NULL AND status = 'pending' AND refund_request_id IS NULL)
        OR (action = 'order_completed' AND source = 'console' AND from_status IS 'pending' AND status = 'paid' AND refund_request_id IS NULL)
        OR (action = 'order_cancelled' AND source = 'console' AND from_status IS 'pending' AND status = 'canceled' AND refund_request_id IS NULL)
        OR (action = 'refund_requested' AND source = 'customer_capability' AND from_status IS 'paid' AND status = 'paid' AND refund_request_id IS NOT NULL)
      )
    )
    OR (
      contract_version = 2
      AND (
        (
          assignee_user_id IS NULL
          AND (
            (action = 'order_created' AND source IN ('storefront','user','system') AND from_status IS NULL AND status = 'pending' AND refund_request_id IS NULL)
            OR (action = 'order_paid' AND source IN ('bootstrap_owner','user','system') AND from_status IS 'pending' AND status = 'paid' AND refund_request_id IS NULL)
            OR (action = 'order_fulfilled' AND source IN ('bootstrap_owner','user','system') AND from_status IS 'paid' AND status = 'fulfilled' AND refund_request_id IS NULL)
            OR (action = 'order_canceled' AND source IN ('bootstrap_owner','user','system') AND from_status IS 'pending' AND status = 'canceled' AND refund_request_id IS NULL)
            OR (action = 'refund_requested' AND source IN ('storefront','bootstrap_owner','user','system') AND from_status IN ('paid','fulfilled') AND from_status IS NOT NULL AND status IS from_status AND refund_request_id IS NOT NULL)
            OR (action IN ('refund_approved','refund_rejected') AND source = 'user' AND actor_id IS NOT NULL AND from_status IN ('paid','fulfilled') AND from_status IS NOT NULL AND status IS from_status AND refund_request_id IS NOT NULL)
          )
        )
        OR (
          action = 'assigned'
          AND source = 'user'
          AND actor_id IS NOT NULL
          AND assignee_user_id IS NOT NULL
          AND from_status IS NOT NULL
          AND status IS from_status
          AND refund_request_id IS NULL
        )
      )
    )
  )
);

CREATE INDEX order_history_order_created_idx
  ON order_history (store_id, order_id, created_at, id);
CREATE UNIQUE INDEX order_history_decision_unique
  ON order_history (store_id, order_id)
  WHERE action IN ('order_paid','order_canceled','order_completed','order_cancelled');
CREATE UNIQUE INDEX order_history_fulfilled_unique
  ON order_history (store_id, order_id)
  WHERE action = 'order_fulfilled';
CREATE UNIQUE INDEX order_history_refund_event_unique
  ON order_history (store_id, order_id, refund_request_id)
  WHERE action = 'refund_requested' AND refund_request_id IS NOT NULL;
CREATE UNIQUE INDEX order_history_refund_terminal_event_unique
  ON order_history (store_id, order_id, refund_request_id)
  WHERE action IN ('refund_approved','refund_rejected') AND refund_request_id IS NOT NULL;
CREATE INDEX order_history_assignee_created_idx
  ON order_history (store_id, assignee_user_id, created_at, id)
  WHERE assignee_user_id IS NOT NULL;

INSERT INTO order_history (
  id, store_id, order_id, status, created_at, action, source, from_status,
  actor_id, contract_version, refund_request_id, assignee_user_id
)
SELECT
  id, store_id, order_id, status, created_at, action, source, from_status,
  actor_id, contract_version, refund_request_id, assignee_user_id
FROM _s4_refund_history;

CREATE TRIGGER order_history_require_member_actor_insert
BEFORE INSERT ON order_history
WHEN NEW.source = 'user' AND NOT EXISTS (
  SELECT 1 FROM store_memberships membership
  WHERE membership.user_id = NEW.actor_id
    AND membership.store_id = NEW.store_id
)
BEGIN
  SELECT RAISE(ABORT, 'user_actor_requires_store_membership');
END;

CREATE TRIGGER order_history_require_member_actor_update
BEFORE UPDATE OF source, actor_id, store_id ON order_history
WHEN NEW.source = 'user' AND NOT EXISTS (
  SELECT 1 FROM store_memberships membership
  WHERE membership.user_id = NEW.actor_id
    AND membership.store_id = NEW.store_id
)
BEGIN
  SELECT RAISE(ABORT, 'user_actor_requires_store_membership');
END;

CREATE TABLE order_assignments (
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  assignee_user_id TEXT NOT NULL,
  assigned_by_user_id TEXT NOT NULL,
  history_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (order_id, store_id),
  CONSTRAINT order_assignments_order_fk
    FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id),
  CONSTRAINT order_assignments_assignee_membership_fk
    FOREIGN KEY (assignee_user_id, store_id) REFERENCES store_memberships(user_id, store_id),
  CONSTRAINT order_assignments_assigner_membership_fk
    FOREIGN KEY (assigned_by_user_id, store_id) REFERENCES store_memberships(user_id, store_id),
  CONSTRAINT order_assignments_history_fk
    FOREIGN KEY (history_id, order_id, store_id) REFERENCES order_history(id, order_id, store_id),
  CONSTRAINT order_assignments_history_unique UNIQUE (history_id, order_id, store_id)
);

CREATE INDEX order_assignments_assignee_order_idx
  ON order_assignments (store_id, assignee_user_id, order_id);

INSERT INTO order_assignments (
  store_id, order_id, assignee_user_id, assigned_by_user_id, history_id,
  assigned_at, updated_at
)
SELECT
  store_id, order_id, assignee_user_id, assigned_by_user_id, history_id,
  assigned_at, updated_at
FROM _s4_refund_assignments;

CREATE TRIGGER order_assignments_require_active_staff
BEFORE INSERT ON order_assignments
WHEN NOT EXISTS (
  SELECT 1 FROM store_memberships membership
  WHERE membership.user_id = NEW.assignee_user_id
    AND membership.store_id = NEW.store_id
    AND membership.role = 'staff'
    AND membership.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'assignment_requires_active_staff');
END;

CREATE TRIGGER order_assignments_require_active_owner
BEFORE INSERT ON order_assignments
WHEN NOT EXISTS (
  SELECT 1 FROM store_memberships membership
  WHERE membership.user_id = NEW.assigned_by_user_id
    AND membership.store_id = NEW.store_id
    AND membership.role = 'owner'
    AND membership.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'assignment_requires_active_owner');
END;

CREATE TRIGGER order_assignments_require_matching_event
BEFORE INSERT ON order_assignments
WHEN NOT EXISTS (
  SELECT 1 FROM order_history history
  WHERE history.id = NEW.history_id
    AND history.order_id = NEW.order_id
    AND history.store_id = NEW.store_id
    AND history.action = 'assigned'
    AND history.source = 'user'
    AND history.actor_id = NEW.assigned_by_user_id
    AND history.assignee_user_id = NEW.assignee_user_id
    AND history.created_at = NEW.assigned_at
)
BEGIN
  SELECT RAISE(ABORT, 'assignment_event_mismatch');
END;

CREATE TRIGGER order_assignments_require_active_staff_update
BEFORE UPDATE OF store_id, assignee_user_id ON order_assignments
WHEN NOT EXISTS (
  SELECT 1 FROM store_memberships membership
  WHERE membership.user_id = NEW.assignee_user_id
    AND membership.store_id = NEW.store_id
    AND membership.role = 'staff'
    AND membership.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'assignment_requires_active_staff');
END;

CREATE TRIGGER order_assignments_require_active_owner_update
BEFORE UPDATE OF store_id, assigned_by_user_id ON order_assignments
WHEN NOT EXISTS (
  SELECT 1 FROM store_memberships membership
  WHERE membership.user_id = NEW.assigned_by_user_id
    AND membership.store_id = NEW.store_id
    AND membership.role = 'owner'
    AND membership.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'assignment_requires_active_owner');
END;

CREATE TRIGGER order_assignments_require_matching_event_update
BEFORE UPDATE OF store_id, order_id, assignee_user_id, assigned_by_user_id, history_id, assigned_at ON order_assignments
WHEN NOT EXISTS (
  SELECT 1 FROM order_history history
  WHERE history.id = NEW.history_id
    AND history.order_id = NEW.order_id
    AND history.store_id = NEW.store_id
    AND history.action = 'assigned'
    AND history.source = 'user'
    AND history.actor_id = NEW.assigned_by_user_id
    AND history.assignee_user_id = NEW.assignee_user_id
    AND history.created_at = NEW.assigned_at
)
BEGIN
  SELECT RAISE(ABORT, 'assignment_event_mismatch');
END;

CREATE TRIGGER order_history_assignment_event_immutable
BEFORE UPDATE ON order_history
WHEN OLD.action = 'assigned'
BEGIN
  SELECT RAISE(ABORT, 'assignment_event_is_immutable');
END;

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
    OR (contract_version = 2 AND action IN ('mark_paid','fulfill','cancel','request_refund','assign','approve_refund','reject_refund'))
  ),
  CONSTRAINT order_commands_result_shape CHECK (
    (action IN ('request_refund','approve_refund','reject_refund') AND result_refund_request_id IS NOT NULL)
    OR (action NOT IN ('request_refund','approve_refund','reject_refund') AND result_refund_request_id IS NULL)
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
  id, store_id, request_key, order_id, action, payload_hash, result_history_id,
  created_at, contract_version, result_refund_request_id
)
SELECT
  id, store_id, request_key, order_id, action, payload_hash, result_history_id,
  created_at, contract_version, result_refund_request_id
FROM _s4_refund_commands;

CREATE TABLE payments (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source = 'manual'),
  method TEXT NOT NULL CHECK (length(method) BETWEEN 1 AND 80 AND method = trim(method)),
  external_reference TEXT NOT NULL CHECK (length(external_reference) BETWEEN 1 AND 160 AND external_reference = trim(external_reference)),
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 0 AND 9007199254740991),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  status TEXT NOT NULL CHECK (status = 'succeeded'),
  history_id TEXT NOT NULL,
  recorded_actor_source TEXT NOT NULL CHECK (recorded_actor_source IN ('bootstrap_owner','storefront','user','system')),
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

CREATE INDEX payments_store_order_idx
  ON payments (store_id, order_id, recorded_at, id);
CREATE INDEX payments_store_external_idx
  ON payments (store_id, external_reference);

INSERT INTO payments (
  id, store_id, order_id, source, method, external_reference, amount_minor, currency,
  status, history_id, recorded_actor_source, recorded_actor_id, recorded_at
)
SELECT
  id, store_id, order_id, source, method, external_reference, amount_minor, currency,
  status, history_id, recorded_actor_source, recorded_actor_id, recorded_at
FROM _s4_refund_payments;

DROP TABLE _s4_refund_assignments;
DROP TABLE _s4_refund_commands;
DROP TABLE _s4_refund_payments;
DROP TABLE _s4_refund_history;
DROP TABLE _s4_refund_requests;

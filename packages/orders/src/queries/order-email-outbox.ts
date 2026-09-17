export type OrderEmailKind = 'order_created' | 'payment_confirmed' | 'payment_reminder';

export type OrderEmailDeliveryLine = {
  product_name: string;
  variant_sku: string | null;
  access_title: string;
  access_instructions: string;
};

export type OrderEmailDeliveryJob = {
  id: string;
  kind: OrderEmailKind;
  reminder_sequence: number | null;
  attempts: number;
  store_id: string;
  order_id: string;
  reference: string;
  status: 'pending' | 'paid' | 'fulfilled' | 'canceled';
  customer_name: string;
  customer_email_normalized: string;
  payment_reference: string;
  total_minor: number;
  currency: string;
  lines: OrderEmailDeliveryLine[];
};

type DueJobRow = Omit<OrderEmailDeliveryJob, 'lines'>;

function retryAt(attempts: number): string {
  const delayMs = Math.min(60 * 60 * 1000, 5 * 60 * 1000 * 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delayMs).toISOString();
}

async function retireExhaustedOrderEmailJobs(database: D1Database): Promise<void> {
  await database.prepare(
    `UPDATE order_email_jobs
        SET delivered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_error = 'attempts_exhausted'
      WHERE delivered_at IS NULL AND attempts >= 12`,
  ).run();
}

async function linesFor(database: D1Database, job: DueJobRow): Promise<OrderEmailDeliveryLine[]> {
  const result = await database.prepare(
    `SELECT product_name, variant_sku, access_title, access_instructions
       FROM order_lines
      WHERE store_id = ? AND order_id = ?
      ORDER BY position`,
  ).bind(job.store_id, job.order_id).all<OrderEmailDeliveryLine>();
  return result.results;
}

async function claimJob(database: D1Database, job: DueJobRow): Promise<boolean> {
  const result = await database.prepare(
    `UPDATE order_email_jobs
        SET attempts = attempts + 1, available_at = ?
      WHERE id = ? AND delivered_at IS NULL AND attempts < 12
        AND available_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).bind(retryAt(job.attempts + 1), job.id).run();
  return result.meta.changes === 1;
}

async function completeOrderEmailJob(database: D1Database, jobId: string, error: string | null = null): Promise<void> {
  await database.prepare(
    `UPDATE order_email_jobs
        SET delivered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_error = ?
      WHERE id = ?`,
  ).bind(error, jobId).run();
}

function needsDelivery(job: DueJobRow): boolean {
  if (job.kind === 'payment_reminder') return job.status === 'pending';
  if (job.kind === 'payment_confirmed') return job.status === 'paid' || job.status === 'fulfilled';
  return true;
}

export async function claimNextOrderEmailDelivery(database: D1Database): Promise<OrderEmailDeliveryJob | null> {
  await retireExhaustedOrderEmailJobs(database);
  const due = await database.prepare(
    `SELECT jobs.id, jobs.kind, jobs.reminder_sequence, jobs.attempts,
            jobs.store_id, jobs.order_id, orders.reference, orders.status,
            orders.customer_name, orders.customer_email_normalized,
            orders.payment_reference, orders.total_minor, orders.currency
       FROM order_email_jobs jobs
       JOIN orders ON orders.id = jobs.order_id AND orders.store_id = jobs.store_id
      WHERE jobs.delivered_at IS NULL
        AND jobs.attempts < 12
        AND jobs.available_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ORDER BY jobs.available_at, jobs.created_at
      LIMIT 20`,
  ).all<DueJobRow>();
  for (const job of due.results) {
    if (!await claimJob(database, job)) continue;
    if (!needsDelivery(job)) {
      await completeOrderEmailJob(database, job.id, 'no_longer_eligible');
      continue;
    }
    return { ...job, attempts: job.attempts + 1, lines: await linesFor(database, job) };
  }
  return null;
}

export async function markOrderEmailDelivered(database: D1Database, jobId: string): Promise<void> {
  await completeOrderEmailJob(database, jobId);
}

export async function rescheduleOrderEmailDelivery(database: D1Database, job: OrderEmailDeliveryJob, reason: string): Promise<void> {
  if (job.attempts >= 12) {
    await completeOrderEmailJob(database, job.id, 'attempts_exhausted');
    return;
  }
  await database.prepare(
    `UPDATE order_email_jobs
        SET available_at = ?, last_error = ?
      WHERE id = ? AND delivered_at IS NULL`,
  ).bind(retryAt(job.attempts + 1), reason.slice(0, 160), job.id).run();
}

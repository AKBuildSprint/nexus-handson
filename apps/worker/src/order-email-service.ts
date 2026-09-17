import {
  claimNextOrderEmailDelivery,
  markOrderEmailDelivered,
  rescheduleOrderEmailDelivery,
  type OrderEmailDeliveryJob,
} from '@nexus/orders/queries/order-email-outbox';
import type { Env } from './environment';

const encoder = new TextEncoder();
const REMINDER_LABELS = ['1 hour', '6 hours', '12 hours', '1 day', '2 days', '3 days'] as const;

type ResendConfiguration = {
  apiKey: string;
  from: string;
  storefrontOrigin: string;
};

function resendConfiguration(env: Pick<Env, 'RESEND_API_KEY' | 'RESEND_FROM' | 'STOREFRONT_ORIGIN'>): ResendConfiguration | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM?.trim();
  const storefrontOrigin = env.STOREFRONT_ORIGIN?.trim();
  if (!apiKey || !from || !storefrontOrigin) return null;
  try {
    new URL(storefrontOrigin);
  } catch {
    return null;
  }
  return { apiKey, from, storefrontOrigin };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export async function orderEmailAccessToken(secret: string, storeId: string, orderId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`nexus-order-email-v1:${storeId}:${orderId}`))));
}

export async function emailTokenMatches(secret: string | undefined, storeId: string, orderId: string, token: string): Promise<boolean> {
  if (!secret?.trim()) return false;
  const expected = await orderEmailAccessToken(secret, storeId, orderId);
  if (token.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < token.length; index += 1) difference |= token.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

function money(value: number, currency: string): string {
  return `${new Intl.NumberFormat('en-US').format(value)} ${currency}`;
}

function orderLink(configuration: ResendConfiguration, job: OrderEmailDeliveryJob): Promise<string> {
  return orderEmailAccessToken(configuration.apiKey, job.store_id, job.order_id).then((token) => {
    const url = new URL(`/orders/${job.reference}`, configuration.storefrontOrigin);
    url.hash = `capability=${token}`;
    return url.toString();
  });
}

function deliveryText(job: OrderEmailDeliveryJob): string {
  if (job.lines.length === 0) return 'No delivery details are available for this Order.';
  return job.lines.map((line) => {
    const variant = line.variant_sku === null ? '' : ` (${line.variant_sku})`;
    return `- ${line.access_title || line.product_name}${variant}\n  ${line.access_instructions || 'Digital delivery is being prepared.'}`;
  }).join('\n');
}

async function messageFor(
  configuration: ResendConfiguration,
  job: OrderEmailDeliveryJob,
): Promise<{ subject: string; text: string }> {
  const link = await orderLink(configuration, job);
  const total = money(job.total_minor, job.currency);
  if (job.kind === 'payment_confirmed') {
    return {
      subject: `Payment confirmed — Nexus Order ${job.reference}`,
      text: `Hi ${job.customer_name},\n\nWe confirmed payment for Order ${job.reference} (${total}).\n\nDemo delivery details:\n${deliveryText(job)}\n\nView your Order: ${link}\n`,
    };
  }
  if (job.kind === 'payment_reminder') {
    const label = job.reminder_sequence === null ? 'scheduled' : REMINDER_LABELS[job.reminder_sequence - 1] ?? 'scheduled';
    return {
      subject: `Payment reminder — Nexus Order ${job.reference}`,
      text: `Hi ${job.customer_name},\n\nYour Order ${job.reference} is still awaiting payment after ${label}. Transfer ${total} with reference ${job.payment_reference}.\n\nOpen your private payment page: ${link}\n`,
    };
  }
  return {
    subject: `Your Nexus Order ${job.reference}`,
    text: `Hi ${job.customer_name},\n\nWe created your pending Order ${job.reference} for ${total}. Complete payment from your private page; it contains the current QR and transfer instructions.\n\nOpen your Order: ${link}\n`,
  };
}

async function sendResend(configuration: ResendConfiguration, job: OrderEmailDeliveryJob): Promise<void> {
  const message = await messageFor(configuration, job);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${configuration.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': job.id,
      'User-Agent': 'Nexus-Operations-Console',
    },
    body: JSON.stringify({ from: configuration.from, to: [job.customer_email_normalized], ...message }),
  });
  if (!response.ok) throw new Error(`resend_${response.status}`);
}

export async function dispatchDueOrderEmails(env: Pick<Env, 'DB' | 'RESEND_API_KEY' | 'RESEND_FROM' | 'STOREFRONT_ORIGIN'>): Promise<number> {
  const configuration = resendConfiguration(env);
  if (configuration === null) return 0;
  let delivered = 0;
  for (let count = 0; count < 20; count += 1) {
    const job = await claimNextOrderEmailDelivery(env.DB);
    if (job === null) break;
    try {
      await sendResend(configuration, job);
      await markOrderEmailDelivered(env.DB, job.id);
      delivered += 1;
    } catch (error) {
      console.error('Order email delivery failed', {
        jobId: job.id,
        kind: job.kind,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      await rescheduleOrderEmailDelivery(env.DB, job, error instanceof Error ? error.message : 'delivery_failed');
    }
  }
  return delivered;
}

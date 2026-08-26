import { describe, expect, it } from 'vitest';
import { inspectAndCountDeliveryBody } from '../../src/files/delivery-file';

async function consume(stream: ReadableStream<Uint8Array>): Promise<number> {
  const reader = stream.getReader();
  let count = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return count;
    count += chunk.value.byteLength;
  }
}

function chunkedBody(total: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent === total) {
        controller.close();
        return;
      }
      const size = Math.min(64 * 1024, total - sent);
      const chunk = new Uint8Array(size);
      if (sent === 0) chunk.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
      sent += size;
      controller.enqueue(chunk);
    },
  });
}

describe('delivery body inspection', () => {
  it('reconstructs the inspected prefix and accepts exactly 25,000,000 actual bytes', async () => {
    const inspected = await inspectAndCountDeliveryBody(chunkedBody(25_000_000));
    expect(inspected.kind).toBe('pdf');
    await expect(consume(inspected.stream)).resolves.toBe(25_000_000);
    expect(inspected.byteCount()).toBe(25_000_000);
  });

  it('rejects byte 25,000,001 while streaming', async () => {
    const inspected = await inspectAndCountDeliveryBody(chunkedBody(25_000_001));
    await expect(consume(inspected.stream)).rejects.toMatchObject({ code: 'delivery_file_size_exceeded' });
  });

  it('authorizes actual bytes rather than filename or browser MIME', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('not a file')); controller.close(); } });
    await expect(inspectAndCountDeliveryBody(body)).rejects.toMatchObject({ code: 'delivery_file_type_invalid' });
  });
});

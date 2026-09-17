import { describe, expect, it } from 'vitest';
import { OrderValidationError } from '@nexus/orders/order-types';
import { parsePayfsCreditInput } from '@nexus/orders/order-validation';

const credit = {
  account_id: '1418079746853494784',
  amount: 14_000,
  bank: 'mb',
  bank_account_number: '0933723830',
  content: 'Ada transfer NP0123456789abcdef0123456789abcdef',
  transaction_date: '2025-09-15T15:02:00.000Z',
  transaction_id: '1418108930751619072',
  transfer_type: 'credit',
};

describe('PayFS credit parser', () => {
  it('accepts the documented flat payload without altering opaque identifiers', () => {
    expect(parsePayfsCreditInput(credit)).toEqual({
      accountId: credit.account_id,
      amount: credit.amount,
      bank: 'MB',
      bankAccountNumber: credit.bank_account_number,
      content: credit.content,
      transactionDate: credit.transaction_date,
      transactionId: credit.transaction_id,
      transferType: 'credit',
    });
  });

  it('rejects unknown fields, malformed transaction shape, impossible calendar dates, and unsafe VND amounts', () => {
    for (const payload of [
      { ...credit, extra: true },
      { ...credit, amount: 14_000.5 },
      { ...credit, amount: Number.POSITIVE_INFINITY },
      { ...credit, transaction_date: '2025-09-15 15:02:00' },
      { ...credit, transaction_date: '2025-02-29T15:02:00.000Z' },
      { ...credit, transaction_date: '2026-02-30T15:02:00.000Z' },
      { ...credit, transaction_date: '2025-01-01T24:00:00.000Z' },
      { ...credit, transaction_id: Number(credit.transaction_id) },
      { ...credit, transfer_type: 'reversed' },
    ]) {
      expect(() => parsePayfsCreditInput(payload)).toThrow(OrderValidationError);
    }
  });
});

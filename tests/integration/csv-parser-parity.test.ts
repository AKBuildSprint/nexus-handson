import { describe, expect, it } from 'vitest';
import { CsvContractError, parseCsvBytes } from '../../src/import/csv-parser';
import { validateCsvRows } from '../../src/import/csv-validator';
import { CSV_HEADER_LINE } from '../../src/shared/csv-contract';
import { CSV_PARSER_CORPUS, normalizeCsvObservation } from '../support/csv-parser-corpus';

describe('Papa Parse workerd contract', () => {
  for (const fixture of CSV_PARSER_CORPUS) {
    it(`normalizes the shared ${fixture.name}`, async () => {
      const workerBody = await new Response(fixture.source).arrayBuffer();
      const parsed = parseCsvBytes(workerBody);

      expect(normalizeCsvObservation(parsed)).toEqual(fixture.expected);
      expect(parsed.byteLength).toBeLessThanOrEqual(1_000_000);
    });
  }

  it('keeps structural UTF-8 failures fatal and semantic status failures group-scoped', () => {
    try {
      parseCsvBytes(Uint8Array.of(0xff));
      expect.fail('Malformed UTF-8 must reject.');
    } catch (error) {
      expect(error).toBeInstanceOf(CsvContractError);
      expect(error).toMatchObject({ code: 'invalid_utf8' });
    }

    const titleCaseStatus = `${CSV_HEADER_LINE}\nstatus-case,Status Case,1.00,USD,Active,,Download,Open,,,,,,,,,,,,,\n`;
    const parsed = parseCsvBytes(new TextEncoder().encode(titleCaseStatus));
    expect(validateCsvRows(parsed.rows).groups[0]).toMatchObject({
      eligible: false,
      issue: { code: 'status_invalid', field: 'product_status' },
    });
  });
});

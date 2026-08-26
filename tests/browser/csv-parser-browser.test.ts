import { describe, expect, it } from 'vitest';
import { parseCsvBytes } from '../../src/import/csv-parser';
import { CSV_PARSER_CORPUS, normalizeCsvObservation } from '../support/csv-parser-corpus';

describe('Papa Parse Chromium contract', () => {
  for (const fixture of CSV_PARSER_CORPUS) {
    it(`normalizes the shared ${fixture.name}`, () => {
      const parsed = parseCsvBytes(new TextEncoder().encode(fixture.source));

      expect(normalizeCsvObservation(parsed)).toEqual(fixture.expected);
      expect(parsed.byteLength).toBeLessThanOrEqual(1_000_000);
    });
  }
});

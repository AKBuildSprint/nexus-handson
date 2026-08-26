import Papa, { type ParseError, type ParseResult } from 'papaparse';
import {
  CSV_HEADER,
  CSV_HEADER_COLUMNS,
  CSV_MAX_BYTES,
  CSV_MAX_DATA_ROWS,
  CSV_PAPA_PARSE_OPTIONS,
  type CsvRow,
  type CsvSourceRow,
} from '../shared/csv-contract';

export type CsvContractErrorCode =
  | 'csv_size_exceeded'
  | 'csv_row_limit_exceeded'
  | 'empty_csv'
  | 'header_mismatch'
  | 'invalid_utf8'
  | 'invalid_csv';

export class CsvContractError extends Error {
  constructor(
    readonly code: CsvContractErrorCode,
    message: string,
    readonly row: number | null = null,
  ) {
    super(message);
    this.name = 'CsvContractError';
  }
}

export interface ParsedCsv {
  byteLength: number;
  rows: CsvSourceRow[];
}

function inputBytes(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

function parserFailure(error: ParseError): CsvContractError {
  const row = typeof error.row === 'number' && error.row > 0 ? error.row : null;
  return new CsvContractError('invalid_csv', error.message, row);
}

export function parseCsvBytes(input: ArrayBuffer | ArrayBufferView): ParsedCsv {
  const bytes = inputBytes(input);
  if (bytes.byteLength > CSV_MAX_BYTES) {
    throw new CsvContractError(
      'csv_size_exceeded',
      `CSV files must be ${CSV_MAX_BYTES.toLocaleString('en-US')} bytes or smaller.`,
    );
  }

  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CsvContractError('invalid_utf8', 'The CSV must contain valid UTF-8.');
  }

  const source = decoded.startsWith('\uFEFF') ? decoded.slice(1) : decoded;
  if (/\r(?!\n)/u.test(source)) {
    throw new CsvContractError('invalid_csv', 'CSV line endings must use LF or CRLF.');
  }

  const parsed: ParseResult<string[]> = Papa.parse<string[]>(source, CSV_PAPA_PARSE_OPTIONS);
  const structuralError = parsed.errors.find((error) => error.code !== 'UndetectableDelimiter');
  if (structuralError) throw parserFailure(structuralError);

  const records = [...parsed.data];
  const terminalRow = records.at(-1);
  if (terminalRow?.length === 1 && terminalRow[0] === '' && /(?:\r\n|\n)$/u.test(source)) records.pop();

  const header = records.shift();
  if (!header || header.length !== CSV_HEADER_COLUMNS || header.some((value, index) => value !== CSV_HEADER[index])) {
    throw new CsvContractError('header_mismatch', 'The CSV header does not match the Nexus import template.');
  }
  if (records.length === 0) {
    throw new CsvContractError('empty_csv', 'The CSV must contain at least one data row.');
  }
  if (records.length > CSV_MAX_DATA_ROWS) {
    throw new CsvContractError(
      'csv_row_limit_exceeded',
      `CSV files may contain at most ${CSV_MAX_DATA_ROWS} data rows.`,
      CSV_MAX_DATA_ROWS + 1,
    );
  }

  const rows = records.map<CsvSourceRow>((values, rowIndex) => {
    const sourceRow = rowIndex + 1;
    if (values.length !== CSV_HEADER_COLUMNS) {
      throw new CsvContractError(
        'invalid_csv',
        `Data row ${sourceRow} must contain exactly ${CSV_HEADER_COLUMNS} columns.`,
        sourceRow,
      );
    }
    const row = Object.fromEntries(CSV_HEADER.map((column, index) => [column, values[index]])) as CsvRow;
    return { ...row, sourceRow };
  });

  return { byteLength: bytes.byteLength, rows };
}

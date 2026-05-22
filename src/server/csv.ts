/**
 * CSV streaming helpers.
 *
 * We don't pull in a CSV library — the format is small enough to do by hand
 * and a generator-based streaming approach lets us export large tables
 * without blowing memory.
 *
 * Quoting is RFC 4180-compliant:
 *   - Always quote strings with commas, double-quotes, CR, or LF
 *   - Double quotes inside a quoted string become "" (escaped)
 *   - We always quote string values to keep the output deterministic
 */

export type CsvCell = string | number | boolean | Date | null | undefined;

export function csvCell(v: CsvCell): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  // string
  const s = String(v);
  if (s === "") return "";
  const needsQuote = /[",\r\n;]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

export function csvRow(cells: CsvCell[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

/**
 * Convert an async iterable of typed records into a ReadableStream<Uint8Array>
 * suitable for returning straight from a Next.js Response.
 *
 * The first chunk is the header row. We prepend a UTF-8 BOM so Excel on
 * Italian locales recognises the encoding (otherwise accents break).
 */
export function streamCsv<T>(
  headers: ReadonlyArray<string>,
  rows: AsyncIterable<T> | Iterable<T>,
  pickCells: (row: T) => CsvCell[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(BOM);
        controller.enqueue(encoder.encode(csvRow(headers as CsvCell[])));
        for await (const r of rows as AsyncIterable<T>) {
          controller.enqueue(encoder.encode(csvRow(pickCells(r))));
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
}

/**
 * Async generator that pages through a Prisma findMany using cursor pagination.
 * Avoids loading everything in memory.
 *
 * Caller provides:
 *   - findPage(cursor): runs the actual Prisma query
 *   - getCursor(item):  extracts the cursor key from the last item of the page
 *
 * Stops when a page returns fewer than `pageSize` items.
 */
export async function* paginate<T>(
  pageSize: number,
  findPage: (cursorId: string | undefined) => Promise<T[]>,
  getCursor: (item: T) => string,
): AsyncGenerator<T> {
  let cursor: string | undefined = undefined;
  while (true) {
    const page = await findPage(cursor);
    if (page.length === 0) return;
    for (const item of page) yield item;
    if (page.length < pageSize) return;
    cursor = getCursor(page[page.length - 1]!);
  }
}

/**
 * Build a Content-Disposition value safe for any filename.
 * Uses RFC 5987 to handle non-ASCII characters.
 */
export function attachmentHeader(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

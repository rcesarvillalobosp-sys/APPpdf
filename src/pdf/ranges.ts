/**
 * Analiza expresiones de páginas como "1-3, 5, 8-" (1-based, inclusivas).
 * "8-" significa "de la 8 al final"; "-3" significa "de la 1 a la 3".
 */
export interface RangeParse {
  ranges: Array<[number, number]>;
  error?: string;
}

export function parseRanges(input: string, total: number): RangeParse {
  const ranges: Array<[number, number]> = [];
  const parts = input
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { ranges, error: 'Escribe al menos una página o intervalo.' };
  for (const part of parts) {
    const m = /^(\d*)\s*(?:[-–]\s*(\d*))?$/.exec(part);
    if (!m || (m[1] === '' && (m[2] === undefined || m[2] === ''))) {
      return { ranges: [], error: `"${part}" no es un intervalo válido. Usa, por ejemplo: 1-3, 5, 8-` };
    }
    const isRange = part.includes('-') || part.includes('–');
    const a = m[1] === '' ? 1 : Number(m[1]);
    const b = isRange ? (m[2] === undefined || m[2] === '' ? total : Number(m[2])) : a;
    if (a < 1 || b < 1 || a > total || b > total) {
      return { ranges: [], error: `"${part}" está fuera del documento (1–${total}).` };
    }
    if (a > b) return { ranges: [], error: `"${part}": el inicio es mayor que el final.` };
    ranges.push([a, b]);
  }
  return { ranges };
}

/** Lista plana de páginas (1-based) sin duplicados, en el orden escrito. */
export function rangesToPages(ranges: Array<[number, number]>): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const [a, b] of ranges) for (let p = a; p <= b; p++) if (!seen.has(p)) seen.add(p), out.push(p);
  return out;
}

import { errorName, openPdf, type PdfDoc } from '../pdf/pdfjs';
import type { ProbeResult } from '../pdf/pdfLibProbe';
import { indexOfBytes } from './FileSignatureValidator';
import type { ProcessingLimits } from './limits';
import { ReportBuilder } from './types';

/**
 * Validación PDF en capas:
 *  1. Estructura en bruto: cabecera, %%EOF (truncado), startxref y su destino.
 *  2. Lectura con pdf.js (stopAtErrors) y detección de contraseña.
 *  3. Interpretación del contenido de cada página (getOperatorList).
 *  4. Carga con pdf-lib (motor de edición) y comparación del número de páginas.
 *  5. Detección de contenido activo (JavaScript, acciones de lanzamiento).
 */

export type PdfProbe = (bytes: Uint8Array) => Promise<ProbeResult>;

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const EOF = ascii('%%EOF');
const STARTXREF = ascii('startxref');

function lastIndexOfBytes(hay: Uint8Array, needle: number[], from: number): number {
  for (let i = hay.length - needle.length; i >= from; i--) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) (ok = false), (j = needle.length);
    if (ok) return i;
  }
  return -1;
}

function textAt(b: Uint8Array, from: number, len: number): string {
  let s = '';
  for (let i = from; i < Math.min(b.length, from + len); i++) s += String.fromCharCode(b[i]);
  return s;
}

/** Comprueba que el desplazamiento de startxref apunta a una tabla "xref" o a un flujo "N G obj". */
export function checkStartXref(b: Uint8Array, headerOffset: number): 'ok' | 'missing' | 'bad' {
  const tail = Math.max(0, b.length - 4096);
  const at = lastIndexOfBytes(b, STARTXREF, tail);
  if (at < 0) return 'missing';
  const m = /^startxref\s+(\d+)/.exec(textAt(b, at, 40));
  if (!m) return 'bad';
  const off = Number(m[1]);
  for (const base of headerOffset ? [off, off + headerOffset] : [off]) {
    if (base >= b.length) continue;
    const t = textAt(b, base, 32);
    if (/^\s*xref/.test(t) || /^\s*\d+\s+\d+\s+obj/.test(t)) return 'ok';
  }
  return 'bad';
}

/** Índices de página que se interpretan: todos o una muestra representativa. */
export function pagesToCheck(numPages: number, max: number): number[] {
  if (numPages <= max) return Array.from({ length: numPages }, (_, i) => i + 1);
  const set = new Set<number>();
  const edge = Math.floor(max / 4);
  for (let i = 1; i <= edge; i++) set.add(i), set.add(numPages - i + 1);
  const rest = max - set.size;
  for (let k = 0; k < rest; k++) set.add(1 + Math.floor(((k + 0.5) * numPages) / rest));
  return [...set].filter((p) => p >= 1 && p <= numPages).sort((a, b) => a - b);
}

export interface PdfInspection {
  pageCount: number;
}

export async function validatePdf(
  bytes: Uint8Array,
  headerOffset: number,
  limits: ProcessingLimits,
  probe: PdfProbe,
  r: ReportBuilder,
  onProgress?: (fraction: number) => void,
): Promise<PdfInspection | null> {
  // ── 1. Estructura en bruto ────────────────────────────────────────────
  r.check('Cabecera %PDF-', true);
  if (headerOffset > 0) {
    r.add('PDF_HEADER_OFFSET', 'info', `Hay ${headerOffset} bytes extra antes de la cabecera PDF.`);
  }
  const hasEof = lastIndexOfBytes(bytes, EOF, Math.max(0, bytes.length - 64 * 1024)) >= 0;
  r.check('Marcador de fin %%EOF', hasEof);
  if (!hasEof) {
    r.add(
      'PDF_NO_EOF',
      'error',
      'El PDF está incompleto: falta el final del archivo (descarga interrumpida o archivo truncado).',
    );
    r.mark('CORRUPTED');
    return null;
  }
  const xref = checkStartXref(bytes, headerOffset);
  r.check('Tabla de referencias cruzadas', xref === 'ok');
  if (xref === 'missing') {
    r.add('PDF_NO_STARTXREF', 'warning', 'No se encontró la referencia a la tabla de objetos (startxref).');
  } else if (xref === 'bad') {
    r.add(
      'PDF_BAD_XREF_OFFSET',
      'warning',
      'La tabla de referencias internas está dañada. Se puede reconstruir, pero revisa el resultado.',
    );
  }
  // Un fallo de xref no es fatal por sí mismo: se degrada a WARNING, no a VALID.
  if (xref !== 'ok') r.checks[r.checks.length - 1].skipped = true;

  // ── 2. Lectura con pdf.js ─────────────────────────────────────────────
  let doc: PdfDoc;
  try {
    doc = await openPdf(bytes);
    r.check('Lectura con pdf.js', true);
  } catch (e) {
    const n = errorName(e);
    if (n === 'PasswordException') {
      r.add('PDF_PASSWORD_REQUIRED', 'error', 'El PDF está protegido con contraseña de apertura.');
      r.mark('PROTECTED');
    } else {
      r.check('Lectura con pdf.js', false);
      r.add(
        'PDF_UNREADABLE',
        'error',
        'El PDF no se puede leer: su estructura interna está dañada.',
        `${n}: ${(e as Error)?.message ?? e}`,
      );
      r.mark('CORRUPTED');
    }
    return null;
  }

  try {
    const numPages = doc.numPages;
    if (numPages < 1) {
      r.add('PDF_NO_PAGES', 'error', 'El PDF no contiene páginas.');
      r.mark('CORRUPTED');
      return null;
    }
    if (numPages > limits.maxPagesPerPdf) {
      r.add('FILE_TOO_LARGE', 'error', `El PDF tiene ${numPages} páginas; el máximo es ${limits.maxPagesPerPdf}.`);
      r.mark('UNSUPPORTED');
      return null;
    }

    // ── 3. Contenido activo ─────────────────────────────────────────────
    const [js, attachments] = await Promise.all([
      doc.getJSActions().catch(() => null),
      doc.getAttachments().catch(() => null),
    ]);
    const rawHasJs =
      indexOfBytes(bytes, Array.from('/JavaScript', (c) => c.charCodeAt(0))) >= 0 ||
      indexOfBytes(bytes, Array.from('/Launch', (c) => c.charCodeAt(0))) >= 0;
    if ((js && js.size > 0) || rawHasJs) {
      r.add(
        'PDF_ACTIVE_CONTENT',
        'warning',
        'Contiene JavaScript o acciones automáticas. Nunca se ejecutan en esta aplicación.',
      );
    }
    if (attachments && attachments.size > 0) {
      r.add('PDF_ACTIVE_CONTENT', 'info', 'Contiene archivos adjuntos incrustados; no se copiarán al resultado.');
    }

    // ── 4. Interpretación de páginas ────────────────────────────────────
    const toCheck = pagesToCheck(numPages, limits.maxPagesFullCheck);
    const broken: number[] = [];
    for (let k = 0; k < toCheck.length; k++) {
      const n = toCheck[k];
      try {
        const page = await doc.getPage(n);
        await page.getOperatorList();
        page.cleanup();
      } catch {
        broken.push(n);
        if (broken.length >= 20) break;
      }
      onProgress?.((k + 1) / toCheck.length);
    }
    r.check('Contenido de las páginas interpretable', broken.length === 0);
    if (broken.length > 0) {
      r.add(
        'PDF_PAGE_UNREADABLE',
        'error',
        `El PDF está parcialmente dañado: no se pudo interpretar la página ${broken.join(', ')}.`,
      );
      r.mark('CORRUPTED');
      return null;
    }
    if (toCheck.length < numPages) {
      r.add(
        'PDF_PAGES_SAMPLED',
        'info',
        `Documento grande: se comprobaron ${toCheck.length} de ${numPages} páginas en profundidad.`,
      );
    }

    // ── 5. Motor de edición (pdf-lib) ───────────────────────────────────
    const probed = await probe(bytes);
    if (!probed.ok) {
      if (probed.encrypted) {
        r.add(
          'PDF_ENCRYPTED',
          'error',
          'El PDF está cifrado con restricciones de edición. Se puede ver, pero no modificar sin la contraseña del propietario.',
        );
        r.mark('PROTECTED');
      } else {
        r.check('Compatible con el motor de edición', false);
        r.add(
          'PDF_EDIT_INCOMPATIBLE',
          'error',
          'La estructura interna del PDF está dañada y no se puede editar con seguridad.',
          probed.message,
        );
        r.mark('CORRUPTED');
      }
      return null;
    }
    r.check('Compatible con el motor de edición', true);
    if (probed.declaredCount !== null && probed.declaredCount !== probed.pageCount) {
      r.check('Árbol de páginas completo', false);
      r.add(
        'PDF_PAGE_COUNT_MISMATCH',
        'error',
        `El documento declara ${probed.declaredCount} páginas pero solo contiene ${probed.pageCount}: faltan páginas o el índice está dañado.`,
      );
      r.mark('CORRUPTED');
      return null;
    }
    const same = probed.pageCount === numPages;
    r.check('Número de páginas coherente', same);
    if (!same) {
      r.add(
        'PDF_PAGE_COUNT_MISMATCH',
        'error',
        `El número de páginas es incoherente (${numPages} según el lector, ${probed.pageCount} según el editor): el árbol de páginas está dañado.`,
      );
      r.mark('CORRUPTED');
      return null;
    }
    return { pageCount: numPages };
  } finally {
    await doc.destroy();
  }
}

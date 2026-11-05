import { openPdf, type PdfDoc } from '../pdf/pdfjs';
import type { OutputSpec } from '../pdf/operations';
import { crc32 } from './crc32';
import { sha256Hex } from './hash';
import { DEFAULT_LIMITS, type ProcessingLimits } from './limits';
import { pagesToCheck, type PdfProbe } from './PdfIntegrityValidator';
import { ReportBuilder, type CheckResult, type IntegrityIssue } from './types';
import { inspectZip } from './ZipIntegrityValidator';

/**
 * Validación de SALIDA. Ningún archivo se ofrece para descargar hasta que:
 *  - se vuelve a abrir con pdf.js y con pdf-lib,
 *  - tiene exactamente las páginas esperadas,
 *  - cada página es interpretable,
 *  - cada página tiene el tamaño y el texto de su página de origen,
 *  - se ha calculado su SHA-256.
 */

export interface OutputVerification {
  ok: boolean;
  issues: IntegrityIssue[];
  checks: CheckResult[];
  sha256?: string;
  pageCount?: number;
}

/** Huella de una página: tamaño visible y texto normalizado. */
export interface PageFingerprint {
  width: number;
  height: number;
  text: string;
}

export async function fingerprintPage(doc: PdfDoc, pageNumber: number, extraRotation = 0): Promise<PageFingerprint> {
  const page = await doc.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1, rotation: (page.rotate + extraRotation) % 360 });
  const tc = await page.getTextContent();
  const text = tc.items
    .map((it) => ('str' in it ? it.str : ''))
    .join('')
    .replace(/\s+/g, '');
  page.cleanup();
  return { width: Math.round(vp.width), height: Math.round(vp.height), text };
}

/** Proveedor de huellas de las páginas de origen (cachea documentos abiertos). */
export type SourceFingerprints = (docId: string, pageIndex: number, rotation: number) => Promise<PageFingerprint>;

export function createSourceFingerprints(sources: Map<string, Uint8Array>): {
  get: SourceFingerprints;
  dispose: () => Promise<void>;
} {
  const docs = new Map<string, Promise<PdfDoc>>();
  return {
    get: async (docId, pageIndex, rotation) => {
      let d = docs.get(docId);
      if (!d) {
        d = openPdf(sources.get(docId)!);
        docs.set(docId, d);
      }
      return fingerprintPage(await d, pageIndex + 1, rotation);
    },
    dispose: async () => {
      for (const d of docs.values()) await (await d).destroy().catch(() => undefined);
      docs.clear();
    },
  };
}

export async function verifyPdfOutput(
  bytes: Uint8Array,
  spec: OutputSpec,
  source: SourceFingerprints,
  probe: PdfProbe,
  limits: ProcessingLimits = DEFAULT_LIMITS,
): Promise<OutputVerification> {
  const r = new ReportBuilder();
  const done = async (pageCount?: number): Promise<OutputVerification> => {
    const status = r.status();
    return {
      ok: status === 'VALID' || status === 'WARNING',
      issues: r.issues,
      checks: r.checks,
      pageCount,
      sha256: status === 'VALID' || status === 'WARNING' ? await sha256Hex(bytes) : undefined,
    };
  };

  if (bytes.length === 0) {
    r.add('OUTPUT_EMPTY', 'error', 'El archivo generado está vacío.');
    r.mark('CORRUPTED');
    return done();
  }

  let doc: PdfDoc;
  try {
    doc = await openPdf(bytes);
    r.check('Resultado legible (pdf.js)', true);
  } catch (e) {
    r.check('Resultado legible (pdf.js)', false);
    r.add('OUTPUT_UNREADABLE', 'error', 'El PDF generado no se puede abrir.', String(e));
    r.mark('CORRUPTED');
    return done();
  }

  try {
    const expected = spec.pages.length;
    const countOk = r.check('Número de páginas esperado', doc.numPages === expected);
    if (!countOk) {
      r.add('OUTPUT_PAGE_COUNT', 'error', `Se esperaban ${expected} páginas y el resultado tiene ${doc.numPages}.`);
      r.mark('CORRUPTED');
      return done(doc.numPages);
    }

    const probed = await probe(bytes);
    r.check('Resultado legible (pdf-lib)', probed.ok && probed.pageCount === expected);
    if (!probed.ok || probed.pageCount !== expected) {
      r.add('OUTPUT_UNREADABLE', 'error', 'El PDF generado no supera la relectura estructural.');
      r.mark('CORRUPTED');
      return done(doc.numPages);
    }

    const sample = pagesToCheck(expected, limits.maxPagesFullCheck);
    const mismatched: number[] = [];
    const unreadable: number[] = [];
    for (const n of sample) {
      try {
        const page = await doc.getPage(n);
        await page.getOperatorList();
        page.cleanup();
        const ref = spec.pages[n - 1];
        const [got, want] = await Promise.all([
          fingerprintPage(doc, n),
          source(ref.docId, ref.pageIndex, ref.rotation),
        ]);
        const sizeOk = Math.abs(got.width - want.width) <= 1 && Math.abs(got.height - want.height) <= 1;
        if (!sizeOk || got.text !== want.text) mismatched.push(n);
      } catch {
        unreadable.push(n);
      }
    }
    r.check('Páginas del resultado interpretables', unreadable.length === 0);
    r.check('Contenido idéntico al de las páginas de origen', mismatched.length === 0);
    if (unreadable.length) {
      r.add('OUTPUT_UNREADABLE', 'error', `Páginas ilegibles en el resultado: ${unreadable.slice(0, 10).join(', ')}.`);
      r.mark('CORRUPTED');
    }
    if (mismatched.length) {
      r.add(
        'OUTPUT_PAGE_COUNT',
        'error',
        `El contenido de las páginas ${mismatched.slice(0, 10).join(', ')} no coincide con el original.`,
      );
      r.mark('CORRUPTED');
    }
    if (sample.length < expected) {
      r.add('PDF_PAGES_SAMPLED', 'info', `Se compararon ${sample.length} de ${expected} páginas con el original.`);
    }
    return done(doc.numPages);
  } finally {
    await doc.destroy();
  }
}

/** Verifica un ZIP generado: estructura, CRC de cada entrada y correspondencia con los archivos verificados. */
export async function verifyZipOutput(
  zipBytes: Uint8Array,
  files: Array<{ name: string; bytes: Uint8Array }>,
  limits: ProcessingLimits = DEFAULT_LIMITS,
): Promise<OutputVerification> {
  const r = new ReportBuilder();
  const insp = await inspectZip(zipBytes, { ...limits, zipMaxUncompressedBytes: Number.MAX_SAFE_INTEGER }, r, () => false);
  if (insp) {
    const missing = files.filter((f) => {
      const e = insp.entries.get(f.name);
      return !e || e.uncompressedSize !== f.bytes.length || e.crc !== crc32(f.bytes);
    });
    r.check('El ZIP contiene todos los resultados verificados', missing.length === 0 && insp.entries.size === files.length);
    if (missing.length) {
      r.add('OUTPUT_UNREADABLE', 'error', `El ZIP no contiene correctamente: ${missing.map((m) => m.name).join(', ')}.`);
      r.mark('CORRUPTED');
    }
  }
  const status = r.status();
  const ok = status === 'VALID' || status === 'WARNING';
  return { ok, issues: r.issues, checks: r.checks, sha256: ok ? await sha256Hex(zipBytes) : undefined };
}

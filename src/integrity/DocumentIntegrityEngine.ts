import { detectSignature, validateSignature } from './FileSignatureValidator';
import { sha256Hex } from './hash';
import { DEFAULT_LIMITS, formatBytes, type ProcessingLimits } from './limits';
import { validateOoxml } from './OfficeIntegrityValidator';
import { validatePdf, type PdfProbe } from './PdfIntegrityValidator';
import { ReportBuilder, type DocumentIntegrityReport, type DocumentKind } from './types';
import { inspectZip } from './ZipIntegrityValidator';

/**
 * Punto de entrada del Document Integrity Engine para archivos de entrada.
 * Ejecuta las capas en orden y se detiene en cuanto el documento queda bloqueado.
 */

export interface EngineOptions {
  limits?: ProcessingLimits;
  /** Prueba con el motor de edición. En el navegador se ejecuta en un Web Worker. */
  pdfProbe?: PdfProbe;
  onProgress?: (fraction: number) => void;
}

export interface InputDescriptor {
  name: string;
  type: string;
  bytes: Uint8Array;
  /** Tamaño real del archivo, si los bytes no se leyeron por superar el límite. */
  size?: number;
}

export async function validateDocument(
  input: InputDescriptor,
  opts: EngineOptions = {},
): Promise<DocumentIntegrityReport> {
  const t0 = performance.now();
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const r = new ReportBuilder();
  const { bytes, name, type } = input;
  const size = input.size ?? bytes.length;
  let detectedKind: DocumentKind = 'unknown';
  let pageCount: number | undefined;
  let sheetNames: string[] | undefined;
  let sha256: string | undefined;

  const finish = (): DocumentIntegrityReport => ({
    fileName: name,
    size,
    declaredMime: type,
    detectedKind,
    status: r.status(),
    issues: r.issues,
    checks: r.checks,
    pageCount,
    sheetNames,
    sha256,
    durationMs: Math.round(performance.now() - t0),
  });

  try {
    // Capa 0: tamaño.
    if (size > limits.maxFileBytes) {
      r.add(
        'FILE_TOO_LARGE',
        'error',
        `El archivo pesa ${formatBytes(size)}; el máximo admitido es ${formatBytes(limits.maxFileBytes)}.`,
      );
      r.mark('UNSUPPORTED');
      return finish();
    }
    if (bytes.length === 0) {
      r.add('EMPTY_FILE', 'error', 'El archivo está vacío (0 bytes).');
      r.mark('CORRUPTED');
      return finish();
    }

    // Capa 1: identificación del formato real.
    const sig = detectSignature(bytes, name);
    detectedKind = sig.binaryKind === 'pdf' ? 'pdf' : sig.binaryKind;
    if (!validateSignature(sig, name, type, r)) return finish();

    sha256 = await sha256Hex(bytes);

    // Capas 2-4: estructura, integridad y prueba de lectura.
    if (sig.binaryKind === 'pdf') {
      const res = await validatePdf(
        bytes,
        sig.pdfHeaderOffset ?? 0,
        limits,
        opts.pdfProbe ?? (await import('../pdf/pdfLibProbe')).probeWithPdfLib,
        r,
        opts.onProgress,
      );
      pageCount = res?.pageCount;
      return finish();
    }

    // Contenedor ZIP → DOCX / XLSX.
    const zip = await inspectZip(bytes, limits, r);
    if (!zip) return finish();
    const expected = sig.extensionKind === 'docx' || sig.extensionKind === 'xlsx' ? sig.extensionKind : 'zip';
    const office = validateOoxml(zip, expected, r);
    if (office) {
      detectedKind = office.kind;
      sheetNames = office.sheetNames;
    }
    return finish();
  } catch (e) {
    r.add('INTERNAL_ERROR', 'error', 'Error inesperado al analizar el archivo.', String(e));
    r.mark('CORRUPTED');
    return finish();
  }
}

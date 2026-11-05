import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

/**
 * Comprueba que pdf-lib (el motor de edición) puede cargar el documento.
 * pdf.js es muy tolerante y reconstruye PDFs rotos; pdf-lib no. Si pdf-lib
 * falla, no podemos garantizar una edición correcta.
 */
export type ProbeResult =
  | { ok: true; pageCount: number; declaredCount: number | null }
  | { ok: false; encrypted: boolean; message: string };

export async function probeWithPdfLib(bytes: Uint8Array): Promise<ProbeResult> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
    const count = doc.catalog.Pages().get(PDFName.of('Count'));
    const declaredCount = count instanceof PDFNumber ? count.asNumber() : null;
    return { ok: true, pageCount: doc.getPageCount(), declaredCount };
  } catch (e) {
    const name = (e as Error)?.constructor?.name ?? '';
    const msg = (e as Error)?.message ?? String(e);
    return { ok: false, encrypted: name === 'EncryptedPDFError' || /encrypted/i.test(msg), message: msg };
  }
}

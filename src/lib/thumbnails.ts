import { openPdf, type PdfDoc } from '../pdf/pdfjs';

/**
 * Miniaturas de página. Cada documento se abre una sola vez y las miniaturas
 * se cachean como object URLs. Todo se libera con releaseAllThumbnails().
 */
const docs = new Map<string, Promise<PdfDoc>>();
const thumbs = new Map<string, Promise<string>>();
const sources = new Map<string, Uint8Array>();

export function registerThumbnailSource(docId: string, bytes: Uint8Array): void {
  sources.set(docId, bytes);
}

function getDoc(docId: string): Promise<PdfDoc> {
  let d = docs.get(docId);
  if (!d) {
    const bytes = sources.get(docId);
    if (!bytes) return Promise.reject(new Error('Documento no registrado'));
    d = openPdf(bytes, { stopAtErrors: false });
    docs.set(docId, d);
  }
  return d;
}

export function getThumbnail(docId: string, pageIndex: number, width = 220): Promise<string> {
  const key = `${docId}:${pageIndex}:${width}`;
  let t = thumbs.get(key);
  if (!t) {
    t = (async () => {
      const doc = await getDoc(docId);
      const page = await doc.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const scale = (width * Math.min(2, window.devicePixelRatio || 1)) / base.width;
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await page.render({ canvas, viewport: vp }).promise;
      page.cleanup();
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
      canvas.width = canvas.height = 0;
      if (!blob) throw new Error('No se pudo generar la miniatura');
      return URL.createObjectURL(blob);
    })();
    t.catch(() => thumbs.delete(key));
    thumbs.set(key, t);
  }
  return t;
}

export async function releaseDocument(docId: string): Promise<void> {
  sources.delete(docId);
  for (const [k, v] of thumbs) {
    if (k.startsWith(`${docId}:`)) {
      thumbs.delete(k);
      v.then(URL.revokeObjectURL, () => undefined);
    }
  }
  const d = docs.get(docId);
  docs.delete(docId);
  if (d) await d.then((x) => x.destroy(), () => undefined);
}

export async function releaseAllThumbnails(): Promise<void> {
  await Promise.all([...docs.keys(), ...sources.keys()].map(releaseDocument));
}

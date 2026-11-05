import { degrees, PDFDocument } from 'pdf-lib';
import type { OutputSpec } from './operations';

/**
 * Genera los PDF con pdf-lib. Cada documento de origen se carga una sola vez.
 * Pensado para ejecutarse dentro de un Web Worker.
 */
export async function buildPdfs(
  sources: Map<string, Uint8Array>,
  outputs: OutputSpec[],
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array[]> {
  const loaded = new Map<string, PDFDocument>();
  const getSource = async (id: string) => {
    let d = loaded.get(id);
    if (!d) {
      const bytes = sources.get(id);
      if (!bytes) throw new Error(`Documento de origen no disponible: ${id}`);
      d = await PDFDocument.load(bytes, { updateMetadata: false });
      loaded.set(id, d);
    }
    return d;
  };

  const results: Uint8Array[] = [];
  for (let k = 0; k < outputs.length; k++) {
    const spec = outputs[k];
    const out = await PDFDocument.create();
    out.setProducer('DocuFusión (pdf-lib)');
    out.setCreator('DocuFusión');
    out.setTitle(spec.fileName.replace(/\.pdf$/i, ''));
    // Copia agrupando páginas consecutivas del mismo origen (más eficiente).
    let i = 0;
    while (i < spec.pages.length) {
      const docId = spec.pages[i].docId;
      let j = i;
      while (j < spec.pages.length && spec.pages[j].docId === docId) j++;
      const run = spec.pages.slice(i, j);
      const src = await getSource(docId);
      const copied = await out.copyPages(
        src,
        run.map((p) => p.pageIndex),
      );
      copied.forEach((page, idx) => {
        const extra = run[idx].rotation;
        if (extra) page.setRotation(degrees((((page.getRotation().angle + extra) % 360) + 360) % 360));
        out.addPage(page);
      });
      i = j;
    }
    results.push(await out.save({ useObjectStreams: true }));
    onProgress?.(k + 1, outputs.length);
  }
  return results;
}

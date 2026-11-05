import type { Dispatch } from 'react';
import { validateDocument } from '../integrity/DocumentIntegrityEngine';
import { createSourceFingerprints, verifyPdfOutput, verifyZipOutput } from '../integrity/OutputIntegrityValidator';
import { planOutputs, type Operation } from '../pdf/operations';
import { processor } from '../workers/client';
import { processablePdfs, type Action, type AppState, type DocItem } from '../state';
import { makeUrl } from './download';
import { registerThumbnailSource } from './thumbnails';

/** Valida documentos de uno en uno para no saturar la memoria. */
let queue: Promise<void> = Promise.resolve();

export function validateQueued(doc: DocItem, dispatch: Dispatch<Action>): void {
  queue = queue.then(async () => {
    const report = await validateDocument(
      { name: doc.name, type: doc.type, bytes: doc.bytes, size: doc.size },
      {
        pdfProbe: processor.probe,
        onProgress: (p) => dispatch({ type: 'docProgress', id: doc.id, progress: p }),
      },
    );
    if (report.detectedKind === 'pdf') registerThumbnailSource(doc.id, doc.bytes);
    dispatch({ type: 'docChecked', id: doc.id, report });
  });
}

export function currentOperation(s: AppState): Operation {
  switch (s.op) {
    case 'merge':
      return { kind: 'merge', fileName: s.mergeName };
    case 'separate':
      return { kind: 'separate' };
    case 'split':
      return { kind: 'split', mode: s.splitMode, ranges: s.ranges, every: s.every };
    case 'extract':
      return { kind: 'extract', selected: s.selected, asSeparateFiles: s.extractSeparate };
  }
}

export function currentPlan(s: AppState) {
  const sources = processablePdfs(s.docs).map((d) => ({ id: d.id, name: d.name }));
  return planOutputs(currentOperation(s), s.pages, sources);
}

/** Ejecuta: generar → verificar cada resultado → (ZIP → verificar ZIP) → habilitar descargas. */
export async function runOperation(s: AppState, dispatch: Dispatch<Action>): Promise<void> {
  const { outputs, error } = currentPlan(s);
  if (error || outputs.length === 0) {
    dispatch({ type: 'run', run: { phase: 'error', message: error ?? 'Nada que procesar.', files: [] } });
    return;
  }
  const used = new Set(outputs.flatMap((o) => o.pages.map((p) => p.docId)));
  const sources = new Map(s.docs.filter((d) => used.has(d.id)).map((d) => [d.id, d.bytes]));

  dispatch({
    type: 'run',
    run: { phase: 'building', progress: 0, message: undefined, zip: undefined, files: outputs.map((spec) => ({ spec })) },
  });

  let built: Uint8Array[];
  try {
    built = await processor.build(sources, outputs, (p) => dispatch({ type: 'run', run: { progress: p } }));
  } catch (e) {
    dispatch({ type: 'run', run: { phase: 'error', message: `No se pudo generar el resultado: ${(e as Error).message}` } });
    return;
  }

  dispatch({ type: 'run', run: { phase: 'verifying', progress: 0 } });
  const fp = createSourceFingerprints(sources);
  const verified: Array<{ name: string; bytes: Uint8Array }> = [];
  try {
    for (let i = 0; i < outputs.length; i++) {
      const v = await verifyPdfOutput(built[i], outputs[i], fp.get, processor.probe);
      const url = v.ok ? makeUrl(built[i], 'application/pdf') : undefined;
      if (v.ok) verified.push({ name: outputs[i].fileName, bytes: built[i] });
      dispatch({ type: 'resultFile', index: i, file: { bytes: v.ok ? built[i] : undefined, url, verification: v } });
      dispatch({ type: 'run', run: { progress: (i + 1) / outputs.length } });
    }
  } finally {
    await fp.dispose();
  }

  const wantsZip = s.delivery === 'zip' && verified.length > 0;
  if (wantsZip) {
    dispatch({ type: 'run', run: { phase: 'zipping', progress: 0 } });
    const name = outputs.length === 1 ? outputs[0].fileName.replace(/\.pdf$/i, '.zip') : 'documentos.zip';
    try {
      const zip = await processor.zip(verified, (p) => dispatch({ type: 'run', run: { progress: p } }));
      const v = await verifyZipOutput(zip, verified);
      dispatch({
        type: 'run',
        run: { zip: { name, size: zip.length, verification: v, url: v.ok ? makeUrl(zip, 'application/zip') : undefined } },
      });
    } catch (e) {
      dispatch({ type: 'run', run: { message: `No se pudo crear el ZIP: ${(e as Error).message}` } });
    }
  }
  dispatch({ type: 'run', run: { phase: 'done', progress: 1 } });
}

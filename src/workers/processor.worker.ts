/// <reference lib="webworker" />
/**
 * Web Worker de procesamiento: todo el trabajo pesado de pdf-lib y JSZip se hace
 * aquí para no bloquear la interfaz. Los documentos nunca salen del dispositivo.
 */
import JSZip from 'jszip';
import { buildPdfs } from '../pdf/build';
import type { OutputSpec } from '../pdf/operations';
import { probeWithPdfLib } from '../pdf/pdfLibProbe';

export type WorkerRequest =
  | { id: number; type: 'probe'; bytes: Uint8Array }
  | { id: number; type: 'build'; sources: Array<[string, Uint8Array]>; outputs: OutputSpec[] }
  | { id: number; type: 'zip'; files: Array<{ name: string; bytes: Uint8Array }> };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { id: number; progress: number };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  const reply = (r: WorkerResponse, transfer: Transferable[] = []) => ctx.postMessage(r, transfer);
  try {
    switch (msg.type) {
      case 'probe':
        reply({ id: msg.id, ok: true, result: await probeWithPdfLib(msg.bytes) });
        break;
      case 'build': {
        const out = await buildPdfs(new Map(msg.sources), msg.outputs, (d, t) => reply({ id: msg.id, progress: d / t }));
        reply({ id: msg.id, ok: true, result: out }, out.map((b) => b.buffer as ArrayBuffer));
        break;
      }
      case 'zip': {
        const z = new JSZip();
        for (const f of msg.files) z.file(f.name, f.bytes, { binary: true });
        const out = await z.generateAsync(
          { type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } },
          (m) => reply({ id: msg.id, progress: m.percent / 100 }),
        );
        reply({ id: msg.id, ok: true, result: out }, [out.buffer as ArrayBuffer]);
        break;
      }
    }
  } catch (err) {
    reply({ id: msg.id, ok: false, error: (err as Error)?.message ?? String(err) });
  }
};

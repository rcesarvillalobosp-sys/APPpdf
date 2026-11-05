import type { OutputSpec } from '../pdf/operations';
import type { ProbeResult } from '../pdf/pdfLibProbe';
import type { WorkerRequest, WorkerResponse } from './processor.worker';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: number) => void };
type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./processor.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if ('progress' in m) return p.onProgress?.(m.progress);
    pending.delete(m.id);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Error en el procesador'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function call<T>(req: Distribute<WorkerRequest>, onProgress?: (p: number) => void): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    getWorker().postMessage({ ...req, id });
  });
}

export const processor = {
  probe: (bytes: Uint8Array) => call<ProbeResult>({ type: 'probe', bytes }),
  build: (sources: Map<string, Uint8Array>, outputs: OutputSpec[], onProgress?: (p: number) => void) =>
    call<Uint8Array[]>({ type: 'build', sources: [...sources], outputs }, onProgress),
  zip: (files: Array<{ name: string; bytes: Uint8Array }>, onProgress?: (p: number) => void) =>
    call<Uint8Array>({ type: 'zip', files }, onProgress),
};

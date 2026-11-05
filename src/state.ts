import type { DocumentIntegrityReport } from './integrity/types';
import { isProcessable } from './integrity/types';
import type { OutputVerification } from './integrity/OutputIntegrityValidator';
import type { OutputSpec, WorkspacePage } from './pdf/operations';

export type Step = 'upload' | 'organize' | 'export' | 'result';

export interface DocItem {
  id: string;
  name: string;
  size: number;
  type: string;
  bytes: Uint8Array;
  /** Color para identificar sus páginas en la cuadrícula. */
  color: string;
  checking: boolean;
  progress: number;
  report?: DocumentIntegrityReport;
}

export type OperationKind = 'merge' | 'separate' | 'split' | 'extract';
export type SplitMode = 'each' | 'ranges' | 'every';
export type Delivery = 'single' | 'separate' | 'zip';

export interface ResultFile {
  spec: OutputSpec;
  bytes?: Uint8Array;
  url?: string;
  verification?: OutputVerification;
}

export interface RunState {
  phase: 'idle' | 'building' | 'verifying' | 'zipping' | 'done' | 'error';
  progress: number;
  message?: string;
  files: ResultFile[];
  zip?: { name: string; url?: string; size: number; verification?: OutputVerification };
}

export interface AppState {
  step: Step;
  docs: DocItem[];
  pages: WorkspacePage[];
  op: OperationKind;
  splitMode: SplitMode;
  ranges: string;
  every: number;
  selected: string[];
  extractSeparate: boolean;
  mergeName: string;
  delivery: Delivery;
  run: RunState;
}

export const initialState: AppState = {
  step: 'upload',
  docs: [],
  pages: [],
  op: 'merge',
  splitMode: 'ranges',
  ranges: '',
  every: 1,
  selected: [],
  extractSeparate: false,
  mergeName: 'documento-unido',
  delivery: 'single',
  run: { phase: 'idle', progress: 0, files: [] },
};

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#84cc16', '#f97316'];

export type Action =
  | { type: 'addDocs'; docs: Omit<DocItem, 'color'>[] }
  | { type: 'docProgress'; id: string; progress: number }
  | { type: 'docChecked'; id: string; report: DocumentIntegrityReport }
  | { type: 'removeDoc'; id: string }
  | { type: 'moveDoc'; from: number; to: number }
  | { type: 'goto'; step: Step }
  | { type: 'buildWorkspace' }
  | { type: 'resetPages' }
  | { type: 'movePage'; from: number; to: number }
  | { type: 'removePage'; id: string }
  | { type: 'rotatePage'; id: string; dir: 1 | -1 }
  | { type: 'rotateAll'; dir: 1 | -1 }
  | { type: 'toggleSelect'; id: string }
  | { type: 'selectAll'; on: boolean }
  | { type: 'removeSelected' }
  | { type: 'set'; patch: Partial<Pick<AppState, 'op' | 'splitMode' | 'ranges' | 'every' | 'extractSeparate' | 'mergeName' | 'delivery'>> }
  | { type: 'run'; run: Partial<RunState> }
  | { type: 'resultFile'; index: number; file: Partial<ResultFile> }
  | { type: 'reset' };

function move<T>(arr: T[], from: number, to: number): T[] {
  const out = arr.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

/** Documentos PDF aptos para procesar, en el orden de la lista. */
export function processablePdfs(docs: DocItem[]): DocItem[] {
  return docs.filter((d) => d.report && d.report.detectedKind === 'pdf' && isProcessable(d.report.status));
}

function workspaceFrom(docs: DocItem[]): WorkspacePage[] {
  const pages: WorkspacePage[] = [];
  for (const d of processablePdfs(docs)) {
    for (let i = 0; i < (d.report?.pageCount ?? 0); i++) {
      pages.push({ id: `${d.id}:${i}`, docId: d.id, pageIndex: i, rotation: 0 });
    }
  }
  return pages;
}

const rot = (r: number, dir: 1 | -1) => ((((r + dir * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'addDocs': {
      const used = s.docs.length;
      const docs = s.docs.concat(a.docs.map((d, i) => ({ ...d, color: COLORS[(used + i) % COLORS.length] })));
      return { ...s, docs };
    }
    case 'docProgress':
      return { ...s, docs: s.docs.map((d) => (d.id === a.id ? { ...d, progress: a.progress } : d)) };
    case 'docChecked':
      return {
        ...s,
        docs: s.docs.map((d) => (d.id === a.id ? { ...d, checking: false, progress: 1, report: a.report } : d)),
      };
    case 'removeDoc':
      return {
        ...s,
        docs: s.docs.filter((d) => d.id !== a.id),
        pages: s.pages.filter((p) => p.docId !== a.id),
        selected: s.selected.filter((id) => !id.startsWith(`${a.id}:`)),
      };
    case 'moveDoc': {
      // Reordena también los grupos de páginas, conservando las ediciones dentro de cada documento.
      const docs = move(s.docs, a.from, a.to);
      const rank = new Map(docs.map((d, i) => [d.id, i]));
      const pages = s.pages
        .map((p, i) => ({ p, i }))
        .sort((x, y) => rank.get(x.p.docId)! - rank.get(y.p.docId)! || x.i - y.i)
        .map((x) => x.p);
      return { ...s, docs, pages };
    }
    case 'goto':
      return { ...s, step: a.step };
    case 'buildWorkspace': {
      // Conserva las ediciones si el conjunto de documentos no ha cambiado.
      const ids = new Set(processablePdfs(s.docs).map((d) => d.id));
      const current = new Set(s.pages.map((p) => p.docId));
      const same = ids.size === current.size && [...ids].every((id) => current.has(id)) && s.pages.length > 0;
      if (same) {
        // Si cambió el orden de los documentos y las páginas siguen agrupadas, reordena los grupos.
        return s;
      }
      return { ...s, pages: workspaceFrom(s.docs), selected: [] };
    }
    case 'resetPages':
      return { ...s, pages: workspaceFrom(s.docs), selected: [] };
    case 'movePage':
      return { ...s, pages: move(s.pages, a.from, a.to) };
    case 'removePage':
      return { ...s, pages: s.pages.filter((p) => p.id !== a.id), selected: s.selected.filter((x) => x !== a.id) };
    case 'rotatePage':
      return { ...s, pages: s.pages.map((p) => (p.id === a.id ? { ...p, rotation: rot(p.rotation, a.dir) } : p)) };
    case 'rotateAll': {
      const sel = new Set(s.selected);
      const target = (id: string) => sel.size === 0 || sel.has(id);
      return { ...s, pages: s.pages.map((p) => (target(p.id) ? { ...p, rotation: rot(p.rotation, a.dir) } : p)) };
    }
    case 'toggleSelect':
      return {
        ...s,
        selected: s.selected.includes(a.id) ? s.selected.filter((x) => x !== a.id) : [...s.selected, a.id],
      };
    case 'selectAll':
      return { ...s, selected: a.on ? s.pages.map((p) => p.id) : [] };
    case 'removeSelected': {
      const sel = new Set(s.selected);
      return { ...s, pages: s.pages.filter((p) => !sel.has(p.id)), selected: [] };
    }
    case 'set':
      return { ...s, ...a.patch };
    case 'run':
      return { ...s, run: { ...s.run, ...a.run } };
    case 'resultFile':
      return {
        ...s,
        run: { ...s.run, files: s.run.files.map((f, i) => (i === a.index ? { ...f, ...a.file } : f)) },
      };
    case 'reset':
      return initialState;
  }
}

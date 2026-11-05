import { parseRanges } from './ranges';

/** Una página del espacio de trabajo: referencia a una página de un documento de origen. */
export interface PageRef {
  docId: string;
  /** Índice 0-based dentro del documento de origen. */
  pageIndex: number;
  /** Rotación adicional aplicada por el usuario. */
  rotation: 0 | 90 | 180 | 270;
}

export interface OutputSpec {
  fileName: string;
  pages: PageRef[];
}

export type SplitMode = 'each' | 'ranges' | 'every';

export type Operation =
  | { kind: 'merge'; fileName?: string }
  | { kind: 'separate' }
  | { kind: 'split'; mode: SplitMode; ranges?: string; every?: number }
  | { kind: 'extract'; selected: string[]; asSeparateFiles: boolean };

export interface WorkspacePage extends PageRef {
  /** Identificador único de la página en el espacio de trabajo. */
  id: string;
}

export interface SourceInfo {
  id: string;
  /** Nombre original del archivo. */
  name: string;
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'documento';
}

/** Evita nombres duplicados dentro de un ZIP. */
export function uniqueNames(specs: OutputSpec[]): OutputSpec[] {
  const used = new Map<string, number>();
  return specs.map((s) => {
    const key = s.fileName.toLowerCase();
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    if (n === 0) return s;
    return { ...s, fileName: s.fileName.replace(/(\.pdf)?$/i, ` (${n + 1}).pdf`) };
  });
}

/**
 * Convierte la operación elegida + el orden actual de páginas en la lista de
 * documentos a generar. Función pura: fácil de probar.
 */
export function planOutputs(
  op: Operation,
  pages: WorkspacePage[],
  sources: SourceInfo[],
): { outputs: OutputSpec[]; error?: string } {
  if (pages.length === 0) return { outputs: [], error: 'No hay páginas para procesar.' };
  const nameOf = new Map(sources.map((s) => [s.id, baseName(s.name)]));
  const strip = (p: WorkspacePage): PageRef => ({ docId: p.docId, pageIndex: p.pageIndex, rotation: p.rotation });

  switch (op.kind) {
    case 'merge':
      return {
        outputs: [{ fileName: `${baseName(op.fileName || 'documento-unido')}.pdf`, pages: pages.map(strip) }],
      };

    case 'separate': {
      const order: string[] = [];
      const groups = new Map<string, PageRef[]>();
      for (const p of pages) {
        if (!groups.has(p.docId)) groups.set(p.docId, []), order.push(p.docId);
        groups.get(p.docId)!.push(strip(p));
      }
      return {
        outputs: uniqueNames(order.map((id) => ({ fileName: `${nameOf.get(id) ?? 'documento'}.pdf`, pages: groups.get(id)! }))),
      };
    }

    case 'split': {
      const base = sources.length === 1 ? baseName(sources[0].name) : 'documento';
      if (op.mode === 'each') {
        const w = String(pages.length).length;
        return {
          outputs: pages.map((p, i) => ({
            fileName: `${base}-pagina-${String(i + 1).padStart(w, '0')}.pdf`,
            pages: [strip(p)],
          })),
        };
      }
      if (op.mode === 'every') {
        const n = Math.floor(op.every ?? 0);
        if (!(n >= 1)) return { outputs: [], error: 'Indica cada cuántas páginas dividir (1 o más).' };
        const outputs: OutputSpec[] = [];
        for (let i = 0; i < pages.length; i += n) {
          const chunk = pages.slice(i, i + n);
          outputs.push({
            fileName: `${base}-parte-${outputs.length + 1} (p${i + 1}-${i + chunk.length}).pdf`,
            pages: chunk.map(strip),
          });
        }
        return { outputs };
      }
      const parsed = parseRanges(op.ranges ?? '', pages.length);
      if (parsed.error) return { outputs: [], error: parsed.error };
      return {
        outputs: parsed.ranges.map(([a, b], i) => ({
          fileName: `${base}-parte-${i + 1} (p${a === b ? a : `${a}-${b}`}).pdf`,
          pages: pages.slice(a - 1, b).map(strip),
        })),
      };
    }

    case 'extract': {
      const sel = new Set(op.selected);
      const chosen = pages.filter((p) => sel.has(p.id));
      if (chosen.length === 0) return { outputs: [], error: 'Selecciona al menos una página para extraer.' };
      if (!op.asSeparateFiles) {
        return { outputs: [{ fileName: 'paginas-extraidas.pdf', pages: chosen.map(strip) }] };
      }
      return {
        outputs: chosen.map((p) => ({
          fileName: `${nameOf.get(p.docId) ?? 'documento'}-pagina-${p.pageIndex + 1}.pdf`,
          pages: [strip(p)],
        })),
      };
    }
  }
}

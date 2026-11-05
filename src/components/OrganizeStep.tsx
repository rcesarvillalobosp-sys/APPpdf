import { useMemo, useRef, type Dispatch, type ReactNode } from 'react';
import { currentPlan } from '../lib/pipeline';
import { useSortable } from '../lib/useSortable';
import { parseRanges } from '../pdf/ranges';
import type { Action, AppState, OperationKind } from '../state';
import {
  IconArrowLeft,
  IconArrowRight,
  IconExtract,
  IconLayers,
  IconMerge,
  IconRotate,
  IconRotateLeft,
  IconSplit,
  IconTrash,
} from './Icons';
import { PageThumb } from './PageThumb';

const OPS: Array<{ id: OperationKind; title: string; desc: string; icon: ReactNode }> = [
  { id: 'merge', title: 'Unir', desc: 'Todas las páginas en un solo PDF', icon: <IconMerge /> },
  { id: 'separate', title: 'Mantener separados', desc: 'Un PDF por documento, con tus cambios', icon: <IconLayers /> },
  { id: 'split', title: 'Dividir', desc: 'Por páginas, intervalos o cada N páginas', icon: <IconSplit /> },
  { id: 'extract', title: 'Extraer páginas', desc: 'Solo las páginas que selecciones', icon: <IconExtract /> },
];

export function OrganizeStep({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const grid = useRef<HTMLOListElement>(null);
  useSortable(grid, (from, to) => dispatch({ type: 'movePage', from, to }), { filter: 'button, input, label', preventOnFilter: false }, state.pages.length > 0);

  const docById = useMemo(() => new Map(state.docs.map((d) => [d.id, d])), [state.docs]);
  const selected = useMemo(() => new Set(state.selected), [state.selected]);
  const plan = currentPlan(state);
  const total = state.pages.length;
  const rangeError = state.op === 'split' && state.splitMode === 'ranges' && state.ranges.trim() ? parseRanges(state.ranges, total).error : undefined;

  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900">¿Qué quieres hacer?</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {OPS.map((o) => {
          const on = state.op === o.id;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => dispatch({ type: 'set', patch: { op: o.id } })}
              className={`rounded-xl border p-4 text-left transition ${
                on ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <span className={on ? 'text-brand-600' : 'text-slate-500'}>{o.icon}</span>
              <span className="mt-2 block font-semibold text-slate-900">{o.title}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{o.desc}</span>
            </button>
          );
        })}
      </div>

      {/* Opciones específicas */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        {state.op === 'merge' && (
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Nombre del archivo resultante</span>
            <div className="mt-1 flex max-w-md items-center rounded-lg border border-slate-300 focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
              <input
                value={state.mergeName}
                onChange={(e) => dispatch({ type: 'set', patch: { mergeName: e.target.value } })}
                className="w-full rounded-lg px-3 py-2 outline-none"
              />
              <span className="pr-3 text-slate-400">.pdf</span>
            </div>
          </label>
        )}
        {state.op === 'separate' && (
          <p className="text-sm text-slate-600">
            Se generará un PDF por cada documento original, aplicando el orden, las rotaciones y las eliminaciones que hagas abajo.
          </p>
        )}
        {state.op === 'split' && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['ranges', 'Por intervalos'],
                  ['every', 'Cada N páginas'],
                  ['each', 'Cada página por separado'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={state.splitMode === id}
                  onClick={() => dispatch({ type: 'set', patch: { splitMode: id } })}
                  className={`rounded-full px-3 py-1.5 font-medium ${
                    state.splitMode === id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {state.splitMode === 'ranges' && (
              <label className="block">
                <span className="font-medium text-slate-700">Intervalos (sobre el orden actual, 1–{total})</span>
                <input
                  value={state.ranges}
                  placeholder="Ej.: 1-3, 4-7, 8-"
                  onChange={(e) => dispatch({ type: 'set', patch: { ranges: e.target.value } })}
                  className={`mt-1 block w-full max-w-md rounded-lg border px-3 py-2 outline-none focus:ring-1 ${
                    rangeError ? 'border-red-400 focus:ring-red-400' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500'
                  }`}
                />
                <span className={`mt-1 block text-xs ${rangeError ? 'text-red-600' : 'text-slate-500'}`}>
                  {rangeError ?? 'Cada intervalo será un PDF. "8-" significa de la 8 al final.'}
                </span>
              </label>
            )}
            {state.splitMode === 'every' && (
              <label className="flex items-center gap-2">
                <span className="font-medium text-slate-700">Dividir cada</span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, total)}
                  value={state.every}
                  onChange={(e) => dispatch({ type: 'set', patch: { every: Number(e.target.value) } })}
                  className="w-20 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
                <span className="text-slate-700">páginas</span>
              </label>
            )}
            {state.splitMode === 'each' && <p className="text-slate-600">Se generarán {total} PDF de una página.</p>}
          </div>
        )}
        {state.op === 'extract' && (
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <p className="text-slate-600">
              Marca las páginas que quieres extraer. <strong>{state.selected.length}</strong> seleccionada(s).
            </p>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={state.extractSeparate}
                onChange={(e) => dispatch({ type: 'set', patch: { extractSeparate: e.target.checked } })}
                className="h-4 w-4 accent-brand-600"
              />
              Un PDF por página
            </label>
          </div>
        )}
      </div>

      {/* Barra de herramientas */}
      <div className="sticky top-0 z-10 mt-6 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/95 py-3 backdrop-blur">
        <h3 className="mr-auto font-semibold text-slate-900">
          Páginas <span className="font-normal text-slate-500">({total})</span>
        </h3>
        <ToolButton onClick={() => dispatch({ type: 'selectAll', on: state.selected.length !== total })}>
          {state.selected.length === total && total > 0 ? 'Quitar selección' : 'Seleccionar todo'}
        </ToolButton>
        <ToolButton onClick={() => dispatch({ type: 'rotateAll', dir: -1 })} title="Girar a la izquierda (seleccionadas o todas)">
          <IconRotateLeft width={16} height={16} />
        </ToolButton>
        <ToolButton onClick={() => dispatch({ type: 'rotateAll', dir: 1 })} title="Girar a la derecha (seleccionadas o todas)">
          <IconRotate width={16} height={16} />
        </ToolButton>
        <ToolButton disabled={state.selected.length === 0} onClick={() => dispatch({ type: 'removeSelected' })} danger>
          <IconTrash width={16} height={16} /> Eliminar seleccionadas
        </ToolButton>
        <ToolButton onClick={() => dispatch({ type: 'resetPages' })}>Restaurar</ToolButton>
      </div>

      <p className="mt-2 text-xs text-slate-500">Arrastra las páginas para cambiar su orden. Haz clic en una página para seleccionarla.</p>

      {total === 0 ? (
        <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
          Has eliminado todas las páginas. Pulsa «Restaurar» para recuperarlas.
        </p>
      ) : (
        <ol ref={grid} className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {state.pages.map((p, i) => {
            const doc = docById.get(p.docId);
            const isSel = selected.has(p.id);
            return (
              <li
                key={p.id}
                onClick={() => dispatch({ type: 'toggleSelect', id: p.id })}
                className={`group relative cursor-pointer select-none rounded-xl border bg-white p-2 shadow-xs transition ${
                  isSel ? 'border-brand-500 ring-2 ring-brand-500' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="relative">
                  <PageThumb docId={p.docId} pageIndex={p.pageIndex} rotation={p.rotation} alt={`Página ${p.pageIndex + 1} de ${doc?.name}`} />
                  <input
                    type="checkbox"
                    checked={isSel}
                    readOnly
                    tabIndex={-1}
                    aria-hidden
                    className="pointer-events-none absolute left-1.5 top-1.5 h-4 w-4 accent-brand-600"
                  />
                  <div className="absolute right-1 top-1 flex gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                    <ThumbButton label="Girar" onClick={() => dispatch({ type: 'rotatePage', id: p.id, dir: 1 })}>
                      <IconRotate width={14} height={14} />
                    </ThumbButton>
                    <ThumbButton label="Eliminar página" danger onClick={() => dispatch({ type: 'removePage', id: p.id })}>
                      <IconTrash width={14} height={14} />
                    </ThumbButton>
                  </div>
                  <div className="absolute bottom-1 left-1 right-1 flex justify-between opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                    <ThumbButton label="Mover a la izquierda" disabled={i === 0} onClick={() => dispatch({ type: 'movePage', from: i, to: i - 1 })}>
                      <IconArrowLeft width={14} height={14} />
                    </ThumbButton>
                    <ThumbButton
                      label="Mover a la derecha"
                      disabled={i === total - 1}
                      onClick={() => dispatch({ type: 'movePage', from: i, to: i + 1 })}
                    >
                      <IconArrowRight width={14} height={14} />
                    </ThumbButton>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-xs">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: doc?.color }} />
                  <span className="truncate text-slate-600" title={doc?.name}>
                    {doc?.name}
                  </span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Pág. {p.pageIndex + 1}</span>
                  <span className="font-semibold text-slate-700">#{i + 1}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={() => dispatch({ type: 'goto', step: 'upload' })} className="rounded-xl px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">
          Atrás
        </button>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <span className={`text-sm ${plan.error ? 'text-red-600' : 'text-slate-500'}`}>
            {plan.error ?? `Se generará${plan.outputs.length === 1 ? '' : 'n'} ${plan.outputs.length} archivo${plan.outputs.length === 1 ? '' : 's'}.`}
          </span>
          <button
            type="button"
            disabled={!!plan.error}
            onClick={() => {
              dispatch({ type: 'set', patch: { delivery: plan.outputs.length > 1 ? 'zip' : 'single' } });
              dispatch({ type: 'goto', step: 'export' });
            }}
            className="rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Continuar
          </button>
        </div>
      </div>
    </section>
  );
}

function ToolButton({
  children,
  onClick,
  disabled,
  danger,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-slate-200 text-slate-700 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function ThumbButton({
  children,
  onClick,
  label,
  danger,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded-md bg-white/95 p-1.5 shadow ring-1 ring-slate-200 disabled:invisible ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

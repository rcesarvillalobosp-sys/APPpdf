import type { Dispatch, ReactNode } from 'react';
import { currentPlan } from '../lib/pipeline';
import type { Action, AppState, Delivery } from '../state';

export function ExportStep({
  state,
  dispatch,
  onRun,
}: {
  state: AppState;
  dispatch: Dispatch<Action>;
  onRun: () => void;
}) {
  const plan = currentPlan(state);
  const n = plan.outputs.length;
  const deliveries: Array<{ id: Delivery; title: string; desc: string; disabled?: boolean }> = [
    { id: 'single', title: 'Un solo documento', desc: n === 1 ? 'Descarga directa del PDF' : `No disponible: la operación genera ${n} archivos`, disabled: n !== 1 },
    { id: 'separate', title: 'Documentos separados', desc: 'Un botón de descarga por archivo' },
    { id: 'zip', title: 'Archivo ZIP', desc: 'Todos los resultados en un único ZIP verificado' },
  ];

  return (
    <section className="space-y-6">
      <Card title="1. ¿Cómo quieres obtener el resultado?">
        <div className="grid gap-3 sm:grid-cols-3">
          {deliveries.map((d) => (
            <Choice
              key={d.id}
              on={state.delivery === d.id}
              disabled={d.disabled}
              onClick={() => dispatch({ type: 'set', patch: { delivery: d.id } })}
              title={d.title}
              desc={d.desc}
            />
          ))}
        </div>
      </Card>

      <Card title="2. ¿En qué formato?">
        <div className="grid gap-3 sm:grid-cols-4">
          <Choice on title="PDF" desc="Formato original de tus documentos" onClick={() => undefined} />
          <Choice disabled title="Word (DOCX)" desc="Próximamente" onClick={() => undefined} />
          <Choice disabled title="Excel (XLSX)" desc="Próximamente" onClick={() => undefined} />
          <Choice disabled title="Imágenes" desc="Próximamente" onClick={() => undefined} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          La conversión a Word y Excel llegará en una próxima fase. No prometemos conversiones que no podamos verificar.
        </p>
      </Card>

      <Card title="3. ¿Quieres modificar el orden antes de exportar?">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => dispatch({ type: 'goto', step: 'organize' })}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Sí, volver a organizar
          </button>
          <span className="self-center text-sm text-slate-500">o continúa con el orden actual.</span>
        </div>
      </Card>

      <Card title={`Resumen: ${n} archivo${n === 1 ? '' : 's'}`}>
        {plan.error ? (
          <p className="text-sm text-red-600">{plan.error}</p>
        ) : (
          <ul className="max-h-60 divide-y divide-slate-100 overflow-auto text-sm">
            {plan.outputs.map((o, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span className="truncate text-slate-800">{o.fileName}</span>
                <span className="shrink-0 text-slate-500">
                  {o.pages.length} pág.
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <button type="button" onClick={() => dispatch({ type: 'goto', step: 'organize' })} className="rounded-xl px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">
          Atrás
        </button>
        <button
          type="button"
          disabled={!!plan.error || (state.delivery === 'single' && n !== 1)}
          onClick={onRun}
          className="rounded-xl bg-brand-600 px-8 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Procesar y verificar
        </button>
      </div>
    </section>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="mb-3 font-semibold text-slate-900">{title}</h3>
      {children}
    </div>
  );
}

function Choice({
  on,
  disabled,
  title,
  desc,
  onClick,
}: {
  on?: boolean;
  disabled?: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={!!on}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <span className="block font-medium text-slate-900">{title}</span>
      <span className="mt-0.5 block text-xs text-slate-500">{desc}</span>
    </button>
  );
}

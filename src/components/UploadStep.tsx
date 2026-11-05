import { useRef, useState, type Dispatch } from 'react';
import { DEFAULT_LIMITS, formatBytes } from '../integrity/limits';
import { useSortable } from '../lib/useSortable';
import { processablePdfs, type Action, type AppState } from '../state';
import { IconFile, IconGrip, IconShield, IconTrash, IconUpload } from './Icons';
import { IssueList, StatusBadge, TechnicalDetails } from './Integrity';

const ACCEPT = '.pdf,.docx,.docm,.xlsx,.xlsm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const KIND_LABEL: Record<string, string> = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', zip: 'ZIP', ole: 'Office antiguo', unknown: 'Desconocido' };

export function UploadStep({
  state,
  dispatch,
  onFiles,
}: {
  state: AppState;
  dispatch: Dispatch<Action>;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [over, setOver] = useState(false);
  useSortable(list, (from, to) => dispatch({ type: 'moveDoc', from, to }), { handle: '.drag-handle' });

  const ready = processablePdfs(state.docs);
  const checking = state.docs.some((d) => d.checking);
  const officeOk = state.docs.filter((d) => d.report && ['docx', 'xlsx'].includes(d.report.detectedKind) && ['VALID', 'WARNING'].includes(d.report.status));

  return (
    <section>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onFiles(Array.from(e.dataTransfer.files));
        }}
        className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
          over ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white hover:border-brand-500'
        }`}
      >
        <div className="mb-4 rounded-full bg-brand-50 p-4 text-brand-600">
          <IconUpload width={30} height={30} />
        </div>
        <h2 className="text-xl font-semibold text-slate-900">Arrastra aquí tus documentos</h2>
        <p className="mt-1 text-sm text-slate-500">o</p>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="mt-3 rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          Seleccionar archivos
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            onFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs">
          <span className="rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-700">PDF</span>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-700">Word .docx</span>
          <span className="rounded-full bg-green-50 px-2.5 py-1 font-medium text-green-700">Excel .xlsx</span>
        </div>
        <p className="mt-3 max-w-md text-xs text-slate-500">
          Hasta {DEFAULT_LIMITS.maxFiles} archivos de {formatBytes(DEFAULT_LIMITS.maxFileBytes)} como máximo.
        </p>
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <IconShield width={15} height={15} /> Tus archivos no salen de tu dispositivo: todo se procesa en tu navegador.
        </p>
      </div>

      {state.docs.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="font-semibold text-slate-900">Documentos ({state.docs.length})</h3>
            <span className="text-xs text-slate-500">Arrastra para cambiar el orden</span>
          </div>
          <ul ref={list} className="space-y-2">
            {state.docs.map((d) => (
              <li key={d.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs sm:p-4">
                <div className="flex items-start gap-3">
                  <button type="button" className="drag-handle mt-1 text-slate-400 hover:text-slate-600" aria-label={`Mover ${d.name}`}>
                    <IconGrip width={18} height={18} />
                  </button>
                  <div className="mt-0.5 rounded-lg p-2" style={{ background: `${d.color}1a`, color: d.color }}>
                    <IconFile width={20} height={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="truncate font-medium text-slate-900" title={d.name}>{d.name}</p>
                      {d.report ? <StatusBadge status={d.report.status} /> : <span className="text-xs text-slate-500">Analizando…</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {d.report ? KIND_LABEL[d.report.detectedKind] : '…'} · {formatBytes(d.size)}
                      {d.report?.pageCount ? ` · ${d.report.pageCount} página${d.report.pageCount === 1 ? '' : 's'}` : ''}
                      {d.report?.sheetNames ? ` · ${d.report.sheetNames.length} hoja(s): ${d.report.sheetNames.join(', ')}` : ''}
                    </p>
                    {d.checking && (
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full bg-brand-500 transition-all" style={{ width: `${Math.max(8, d.progress * 100)}%` }} />
                      </div>
                    )}
                    {d.report && <IssueList issues={d.report.issues} />}
                    {d.report && (
                      <TechnicalDetails checks={d.report.checks} sha256={d.report.sha256} issues={d.report.issues} durationMs={d.report.durationMs} />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'removeDoc', id: d.id })}
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Quitar ${d.name}`}
                  >
                    <IconTrash width={18} height={18} />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {officeOk.length > 0 && (
            <p className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
              Los documentos Word y Excel se han verificado, pero su combinación y conversión llegarán en la siguiente fase.
              Por ahora solo se procesan los PDF.
            </p>
          )}

          <div className="mt-6 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              {checking
                ? 'Comprobando la integridad de los documentos…'
                : ready.length === 0
                  ? 'Añade al menos un PDF válido para continuar.'
                  : `${ready.length} PDF listo${ready.length === 1 ? '' : 's'} para procesar.`}
            </p>
            <button
              type="button"
              disabled={checking || ready.length === 0}
              onClick={() => {
                dispatch({ type: 'buildWorkspace' });
                dispatch({ type: 'goto', step: 'organize' });
              }}
              className="rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Continuar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

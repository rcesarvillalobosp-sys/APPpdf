import type { Dispatch } from 'react';
import { formatBytes } from '../integrity/limits';
import { triggerDownload } from '../lib/download';
import type { Action, AppState } from '../state';
import { IconDownload, IconFile, IconShield, IconZip } from './Icons';
import { IssueList, TechnicalDetails, VerifiedBadge } from './Integrity';

const PHASE_LABEL = {
  idle: 'Preparando…',
  building: 'Generando documentos…',
  verifying: 'Verificando cada resultado (relectura, páginas, contenido y SHA-256)…',
  zipping: 'Creando y verificando el ZIP…',
  done: 'Listo',
  error: 'Error',
} as const;

export function ResultStep({
  state,
  dispatch,
  onRestart,
}: {
  state: AppState;
  dispatch: Dispatch<Action>;
  onRestart: () => void;
}) {
  const { run } = state;
  const busy = run.phase !== 'done' && run.phase !== 'error';
  const okCount = run.files.filter((f) => f.verification?.ok).length;
  const failed = run.files.filter((f) => f.verification && !f.verification.ok).length;
  const showFiles = state.delivery !== 'zip' || !run.zip?.url;

  return (
    <section>
      {busy && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6" role="status" aria-live="polite">
          <p className="font-medium text-slate-900">{PHASE_LABEL[run.phase]}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${Math.max(4, run.progress * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-500">Todo ocurre en tu navegador. No cierres esta pestaña.</p>
        </div>
      )}

      {run.phase === 'error' && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">
          <p className="font-semibold">No se pudo completar la operación</p>
          <p className="mt-1 text-sm">{run.message}</p>
        </div>
      )}

      {run.phase === 'done' && (
        <div
          className={`rounded-2xl border p-6 ${failed ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}
        >
          <div className="flex items-start gap-3">
            <IconShield width={28} height={28} className={failed ? 'text-amber-600' : 'text-emerald-600'} />
            <div>
              <p className="text-lg font-semibold text-slate-900">
                {failed === 0
                  ? `${okCount} archivo${okCount === 1 ? '' : 's'} generado${okCount === 1 ? '' : 's'} y verificado${okCount === 1 ? '' : 's'}`
                  : `${okCount} verificado(s), ${failed} con errores`}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Cada archivo se ha vuelto a abrir y comparado página a página con los originales. Solo se pueden descargar
                los que superan todas las comprobaciones.
              </p>
              {run.message && <p className="mt-2 text-sm text-red-700">{run.message}</p>}
            </div>
          </div>
        </div>
      )}

      {run.zip && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            <IconZip width={26} height={26} className="text-brand-600" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-slate-900">{run.zip.name}</p>
              <p className="text-xs text-slate-500">
                {formatBytes(run.zip.size)} · {okCount} archivo{okCount === 1 ? '' : 's'}
              </p>
            </div>
            {run.zip.verification && <VerifiedBadge ok={run.zip.verification.ok} />}
            {run.zip.url && (
              <button
                type="button"
                onClick={() => triggerDownload(run.zip!.url!, run.zip!.name)}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
              >
                <IconDownload width={18} height={18} /> Descargar ZIP
              </button>
            )}
          </div>
          {run.zip.verification && (
            <>
              <IssueList issues={run.zip.verification.issues} />
              <TechnicalDetails checks={run.zip.verification.checks} sha256={run.zip.verification.sha256} />
            </>
          )}
        </div>
      )}

      {run.files.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 font-semibold text-slate-900">
            {showFiles ? 'Archivos' : 'Contenido del ZIP'} ({run.files.length})
          </h3>
          <ul className="space-y-2">
            {run.files.map((f, i) => (
              <li key={i} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <IconFile width={20} height={20} className="text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{f.spec.fileName}</p>
                    <p className="text-xs text-slate-500">
                      {f.spec.pages.length} pág.{f.bytes ? ` · ${formatBytes(f.bytes.length)}` : ''}
                    </p>
                  </div>
                  {f.verification ? <VerifiedBadge ok={f.verification.ok} /> : <span className="text-xs text-slate-400">Pendiente</span>}
                  {f.url && showFiles && (
                    <button
                      type="button"
                      onClick={() => triggerDownload(f.url!, f.spec.fileName)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-100"
                    >
                      <IconDownload width={16} height={16} /> Descargar
                    </button>
                  )}
                </div>
                {f.verification && (
                  <>
                    <IssueList issues={f.verification.issues.filter((x) => x.severity !== 'info' || !f.verification!.ok)} />
                    <TechnicalDetails checks={f.verification.checks} sha256={f.verification.sha256} />
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!busy && (
        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={() => dispatch({ type: 'goto', step: 'organize' })}
            className="rounded-xl px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Volver a editar
          </button>
          <button
            type="button"
            onClick={onRestart}
            className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100"
          >
            Empezar de nuevo (borra todo de la memoria)
          </button>
        </div>
      )}
    </section>
  );
}

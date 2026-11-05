import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from 'react';
import { ExportStep } from './components/ExportStep';
import { IconShield } from './components/Icons';
import { OrganizeStep } from './components/OrganizeStep';
import { ResultStep } from './components/ResultStep';
import { UploadStep } from './components/UploadStep';
import { DEFAULT_LIMITS, formatBytes } from './integrity/limits';
import { runOperation, validateQueued } from './lib/pipeline';
import { releaseAllThumbnails, releaseDocument } from './lib/thumbnails';
import { initialState, reducer, type Action, type AppState, type Step } from './state';

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'upload', label: 'Subir' },
  { id: 'organize', label: 'Organizar' },
  { id: 'export', label: 'Exportar' },
  { id: 'result', label: 'Descargar' },
];

function revokeResults(s: AppState) {
  for (const f of s.run.files) if (f.url) URL.revokeObjectURL(f.url);
  if (s.run.zip?.url) URL.revokeObjectURL(s.run.zip.url);
}

export default function App() {
  const [state, rawDispatch] = useReducer(reducer, initialState);
  const [notice, setNotice] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Libera la memoria de miniaturas al quitar un documento.
  const dispatch: Dispatch<Action> = useCallback((a: Action) => {
    if (a.type === 'removeDoc') void releaseDocument(a.id);
    rawDispatch(a);
  }, []);

  // Aviso al cerrar la pestaña con trabajo en curso (los archivos solo viven en memoria).
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (stateRef.current.docs.length > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  // Cada pantalla empieza arriba.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [state.step]);

  const onFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const s = stateRef.current;
      const room = DEFAULT_LIMITS.maxFiles - s.docs.length;
      let total = s.docs.reduce((n, d) => n + d.size, 0);
      const accepted: File[] = [];
      const rejected: string[] = [];
      for (const f of files) {
        if (accepted.length >= room) {
          rejected.push(`${f.name} (máximo ${DEFAULT_LIMITS.maxFiles} archivos)`);
        } else if (total + f.size > DEFAULT_LIMITS.maxTotalBytes) {
          rejected.push(`${f.name} (se superaría el total de ${formatBytes(DEFAULT_LIMITS.maxTotalBytes)})`);
        } else {
          accepted.push(f);
          total += f.size;
        }
      }
      setNotice(rejected.length ? `No se añadieron: ${rejected.join('; ')}` : null);
      const docs = await Promise.all(
        accepted.map(async (f) => ({
          id: crypto.randomUUID(),
          name: f.name,
          size: f.size,
          type: f.type,
          bytes: f.size <= DEFAULT_LIMITS.maxFileBytes ? new Uint8Array(await f.arrayBuffer()) : new Uint8Array(0),
          checking: true,
          progress: 0,
        })),
      );
      dispatch({ type: 'addDocs', docs });
      // Los archivos que superan el límite no se leen: el motor informa del tamaño.
      for (const d of docs) validateQueued({ ...d, color: '' }, dispatch);
    },
    [dispatch],
  );

  const onRun = useCallback(() => {
    revokeResults(stateRef.current);
    dispatch({ type: 'goto', step: 'result' });
    void runOperation(stateRef.current, dispatch);
  }, [dispatch]);

  const onRestart = useCallback(() => {
    revokeResults(stateRef.current);
    void releaseAllThumbnails();
    dispatch({ type: 'reset' });
    setNotice(null);
  }, [dispatch]);

  const stepIndex = STEPS.findIndex((s) => s.id === state.step);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={32} height={32} />
          <div className="mr-auto">
            <h1 className="text-lg font-bold leading-tight text-slate-900">DocuFusión</h1>
            <p className="text-xs text-slate-500">Une, separa y ordena documentos. Gratis, sin registro.</p>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 sm:inline-flex">
            <IconShield width={14} height={14} /> 100% en tu navegador
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-10">
        <nav aria-label="Pasos" className="mb-8">
          <ol className="flex items-center gap-2 text-sm">
            {STEPS.map((s, i) => {
              const done = i < stepIndex;
              const current = i === stepIndex;
              return (
                <li key={s.id} className="flex flex-1 items-center gap-2">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      current ? 'bg-brand-600 text-white' : done ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-500'
                    }`}
                    aria-current={current ? 'step' : undefined}
                  >
                    {i + 1}
                  </span>
                  <span className={`hidden sm:inline ${current ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{s.label}</span>
                  {i < STEPS.length - 1 && <span className={`h-px flex-1 ${done ? 'bg-brand-300' : 'bg-slate-200'}`} />}
                </li>
              );
            })}
          </ol>
        </nav>

        {notice && (
          <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800" role="alert">
            {notice}
          </div>
        )}

        {state.step === 'upload' && <UploadStep state={state} dispatch={dispatch} onFiles={onFiles} />}
        {state.step === 'organize' && <OrganizeStep state={state} dispatch={dispatch} />}
        {state.step === 'export' && <ExportStep state={state} dispatch={dispatch} onRun={onRun} />}
        {state.step === 'result' && <ResultStep state={state} dispatch={dispatch} onRestart={onRestart} />}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-5 text-xs leading-relaxed text-slate-500">
          Tus documentos se procesan localmente en tu dispositivo y nunca se envían a ningún servidor. Desaparecen al
          cerrar o recargar la página. Cada archivo se comprueba antes de procesarlo y cada resultado se verifica antes de
          poder descargarlo.
        </div>
      </footer>
    </div>
  );
}

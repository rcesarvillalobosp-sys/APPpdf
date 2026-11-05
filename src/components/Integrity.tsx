import { useState } from 'react';
import type { OutputVerification } from '../integrity/OutputIntegrityValidator';
import { STATUS_LABEL, type CheckResult, type IntegrityIssue, type IntegrityStatus } from '../integrity/types';
import { IconAlert, IconCheck, IconLock, IconX } from './Icons';

const STYLE: Record<IntegrityStatus, string> = {
  VALID: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  WARNING: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  CORRUPTED: 'bg-red-50 text-red-700 ring-red-600/20',
  PROTECTED: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  UNSUPPORTED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

export function StatusBadge({ status }: { status: IntegrityStatus }) {
  const Icon = status === 'VALID' ? IconCheck : status === 'PROTECTED' ? IconLock : status === 'WARNING' ? IconAlert : IconX;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STYLE[status]}`}>
      <Icon width={13} height={13} strokeWidth={2.6} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function VerifiedBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
      <IconCheck width={13} height={13} strokeWidth={2.6} /> Verificado
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-600/20">
      <IconX width={13} height={13} strokeWidth={2.6} /> Falló la verificación
    </span>
  );
}

const SEV_COLOR = { error: 'text-red-700', warning: 'text-amber-800', info: 'text-slate-600' } as const;

export function IssueList({ issues }: { issues: IntegrityIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {issues.map((i, k) => (
        <li key={k} className={`flex gap-2 ${SEV_COLOR[i.severity]}`}>
          <span className="mt-0.5 shrink-0">
            {i.severity === 'error' ? <IconX width={15} height={15} /> : i.severity === 'warning' ? <IconAlert width={15} height={15} /> : <span className="inline-block w-[15px] text-center">i</span>}
          </span>
          <span>{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function TechnicalDetails({
  checks,
  sha256,
  issues,
  durationMs,
}: {
  checks: CheckResult[];
  sha256?: string;
  issues?: IntegrityIssue[];
  durationMs?: number;
}) {
  const [open, setOpen] = useState(false);
  const details = (issues ?? []).filter((i) => i.detail);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-brand-600 hover:text-brand-700"
        aria-expanded={open}
      >
        {open ? 'Ocultar detalles técnicos' : 'Ver detalles técnicos'}
      </button>
      {open && (
        <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
          <ul className="grid gap-1 sm:grid-cols-2">
            {checks.map((c, k) => (
              <li key={k} className="flex items-center gap-1.5">
                {c.skipped ? (
                  <span className="text-amber-600">–</span>
                ) : c.passed ? (
                  <IconCheck width={13} height={13} className="text-emerald-600" />
                ) : (
                  <IconX width={13} height={13} className="text-red-600" />
                )}
                {c.name}
              </li>
            ))}
          </ul>
          {details.map((d, k) => (
            <p key={k} className="mt-2 break-words font-mono text-[11px] text-slate-500">{d.detail}</p>
          ))}
          {sha256 && (
            <p className="mt-2 break-all font-mono text-[11px] text-slate-500">
              SHA-256: {sha256}
            </p>
          )}
          {durationMs !== undefined && <p className="mt-1 text-[11px] text-slate-400">Análisis: {durationMs} ms</p>}
        </div>
      )}
    </div>
  );
}

export function verificationSummary(v?: OutputVerification): string {
  if (!v) return 'Pendiente';
  return v.ok ? 'Verificado' : 'Falló la verificación';
}

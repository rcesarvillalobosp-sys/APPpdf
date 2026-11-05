/**
 * Document Integrity Engine — tipos compartidos.
 *
 * Regla principal: un documento solo es VALID cuando TODAS las comprobaciones
 * aplicables han pasado. Que una librería consiga abrirlo no basta.
 */

export type IntegrityStatus = 'VALID' | 'WARNING' | 'CORRUPTED' | 'PROTECTED' | 'UNSUPPORTED';

export type DocumentKind = 'pdf' | 'docx' | 'xlsx' | 'zip' | 'ole' | 'unknown';

export type IssueSeverity = 'info' | 'warning' | 'error';

/** Códigos estables para pruebas e interfaz. */
export type IssueCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'EXTENSION_MISMATCH'
  | 'MIME_MISMATCH'
  | 'UNKNOWN_SIGNATURE'
  | 'UNSUPPORTED_FORMAT'
  | 'LEGACY_OFFICE_FORMAT'
  | 'PDF_NO_HEADER'
  | 'PDF_HEADER_OFFSET'
  | 'PDF_NO_EOF'
  | 'PDF_NO_STARTXREF'
  | 'PDF_BAD_XREF_OFFSET'
  | 'PDF_UNREADABLE'
  | 'PDF_PAGE_UNREADABLE'
  | 'PDF_PAGE_COUNT_MISMATCH'
  | 'PDF_EDIT_INCOMPATIBLE'
  | 'PDF_ENCRYPTED'
  | 'PDF_PASSWORD_REQUIRED'
  | 'PDF_ACTIVE_CONTENT'
  | 'PDF_NO_PAGES'
  | 'PDF_PAGES_SAMPLED'
  | 'ZIP_NO_EOCD'
  | 'ZIP_TRUNCATED'
  | 'ZIP_CENTRAL_DIRECTORY'
  | 'ZIP_CRC_MISMATCH'
  | 'ZIP_BOMB'
  | 'ZIP_TOO_MANY_ENTRIES'
  | 'ZIP_ENCRYPTED_ENTRY'
  | 'ZIP_UNSAFE_PATH'
  | 'OOXML_MISSING_PART'
  | 'OOXML_MALFORMED_XML'
  | 'OOXML_BROKEN_RELATIONSHIP'
  | 'OOXML_WRONG_TYPE'
  | 'OOXML_ENCRYPTED'
  | 'OOXML_MACROS'
  | 'OOXML_EXTERNAL_LINKS'
  | 'OOXML_EMBEDDED_OBJECTS'
  | 'XLSX_NO_SHEETS'
  | 'XLSX_FORMULAS'
  | 'OUTPUT_UNREADABLE'
  | 'OUTPUT_PAGE_COUNT'
  | 'OUTPUT_EMPTY'
  | 'INTERNAL_ERROR';

export interface IntegrityIssue {
  code: IssueCode;
  severity: IssueSeverity;
  /** Mensaje en español, listo para mostrar al usuario. */
  message: string;
  /** Detalle técnico opcional (para el panel "ver detalles"). */
  detail?: string;
}

/** Resultado de cada comprobación individual, para que el informe sea auditable. */
export interface CheckResult {
  name: string;
  passed: boolean;
  /** true si la comprobación no se ejecutó (p. ej. no aplica o se cortó antes). */
  skipped?: boolean;
}

export interface DocumentIntegrityReport {
  fileName: string;
  size: number;
  declaredMime: string;
  detectedKind: DocumentKind;
  status: IntegrityStatus;
  issues: IntegrityIssue[];
  checks: CheckResult[];
  /** Solo para PDF. */
  pageCount?: number;
  /** Solo para XLSX. */
  sheetNames?: string[];
  sha256?: string;
  durationMs: number;
}

/** Acumulador que usan los validadores. */
export class ReportBuilder {
  readonly issues: IntegrityIssue[] = [];
  readonly checks: CheckResult[] = [];
  /** Estados "duros" señalados explícitamente por los validadores. */
  private hard: IntegrityStatus | null = null;

  add(code: IssueCode, severity: IssueSeverity, message: string, detail?: string): void {
    this.issues.push({ code, severity, message, detail });
  }

  check(name: string, passed: boolean, skipped = false): boolean {
    this.checks.push({ name, passed, skipped: skipped || undefined });
    return passed;
  }

  /** Marca un estado definitivo. CORRUPTED/PROTECTED/UNSUPPORTED no se rebajan. */
  mark(status: Exclude<IntegrityStatus, 'VALID' | 'WARNING'>): void {
    const rank: Record<IntegrityStatus, number> = {
      VALID: 0,
      WARNING: 1,
      PROTECTED: 2,
      UNSUPPORTED: 3,
      CORRUPTED: 4,
    };
    if (!this.hard || rank[status] > rank[this.hard]) this.hard = status;
  }

  get blocked(): boolean {
    return this.hard !== null;
  }

  /**
   * Estado final. VALID solo si no hay estado duro, ninguna comprobación ejecutada
   * falló y no hay incidencias de nivel warning/error.
   */
  status(): IntegrityStatus {
    if (this.hard) return this.hard;
    const failed = this.checks.some((c) => !c.passed && !c.skipped);
    if (failed || this.issues.some((i) => i.severity === 'error')) return 'CORRUPTED';
    if (this.issues.some((i) => i.severity === 'warning')) return 'WARNING';
    return 'VALID';
  }
}

export const STATUS_LABEL: Record<IntegrityStatus, string> = {
  VALID: 'Válido',
  WARNING: 'Advertencia',
  CORRUPTED: 'Corrupto',
  PROTECTED: 'Protegido',
  UNSUPPORTED: 'No compatible',
};

export function isProcessable(status: IntegrityStatus): boolean {
  return status === 'VALID' || status === 'WARNING';
}

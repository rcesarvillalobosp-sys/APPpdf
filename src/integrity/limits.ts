/**
 * Límites de procesamiento. Protegen la memoria del navegador y evitan
 * ataques tipo ZIP bomb. Son deliberadamente generosos pero finitos.
 */
export interface ProcessingLimits {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  maxPagesPerPdf: number;
  /** Páginas cuyo contenido se interpreta por completo; por encima se muestrea. */
  maxPagesFullCheck: number;
  zipMaxEntries: number;
  zipMaxUncompressedBytes: number;
  /** Relación máxima tamaño descomprimido / comprimido por entrada. */
  zipMaxRatio: number;
  /** Las entradas pequeñas comprimen muchísimo (XML repetitivo); no aplicar ratio por debajo de esto. */
  zipRatioMinBytes: number;
  /** Tamaño máximo de un XML que se parsea para validarlo. */
  maxXmlBytes: number;
}

const MB = 1024 * 1024;

export const DEFAULT_LIMITS: ProcessingLimits = {
  maxFileBytes: 150 * MB,
  maxTotalBytes: 400 * MB,
  maxFiles: 60,
  maxPagesPerPdf: 3000,
  maxPagesFullCheck: 400,
  zipMaxEntries: 5000,
  zipMaxUncompressedBytes: 600 * MB,
  zipMaxRatio: 200,
  zipRatioMinBytes: 2 * MB,
  maxXmlBytes: 80 * MB,
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * MB) return `${(n / MB).toFixed(1)} MB`;
  return `${(n / (1024 * MB)).toFixed(2)} GB`;
}

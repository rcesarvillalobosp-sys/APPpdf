/**
 * Adaptador de pdf.js. En el navegador usa el build normal con su propio worker;
 * las pruebas (Node) inyectan el build "legacy" con setPdfJsLoader().
 */
import type * as PdfJsModule from 'pdfjs-dist';

export type PdfJs = typeof PdfJsModule;
type PdfProxy = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;
/** Documento abierto. En pdf.js v6 se libera a través de su tarea de carga. */
export type PdfDoc = PdfProxy & { destroy(): Promise<void> };

let loader: () => Promise<PdfJs> = async () => {
  const [mod, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  mod.GlobalWorkerOptions.workerSrc = worker.default;
  return mod;
};
let cached: Promise<PdfJs> | null = null;
// BASE_URL permite publicar en una subruta (p. ej. GitHub Pages: /nombre-del-repo/).
let assetBase = `${import.meta.env.BASE_URL}pdfjs/`;

export function setPdfJsLoader(fn: () => Promise<PdfJs>, assets = ''): void {
  loader = fn;
  cached = null;
  assetBase = assets;
}

export function loadPdfJs(): Promise<PdfJs> {
  cached ??= loader();
  return cached;
}

/**
 * Abre un PDF con opciones seguras: sin scripts, sin XFA, deteniéndose en errores.
 * pdf.js transfiere (desvincula) el buffer, por eso siempre se pasa una copia.
 */
export async function openPdf(
  bytes: Uint8Array,
  opts: { password?: string; stopAtErrors?: boolean } = {},
): Promise<PdfDoc> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password: opts.password,
    stopAtErrors: opts.stopAtErrors ?? true,
    enableXfa: false,
    verbosity: 0,
    ...(assetBase
      ? {
          cMapUrl: `${assetBase}cmaps/`,
          standardFontDataUrl: `${assetBase}standard_fonts/`,
          wasmUrl: `${assetBase}wasm/`,
        }
      : {}),
  });
  const doc = (await task.promise) as PdfDoc;
  doc.destroy = () => task.destroy();
  return doc;
}

export function errorName(e: unknown): string {
  return (e as { name?: string })?.name ?? '';
}

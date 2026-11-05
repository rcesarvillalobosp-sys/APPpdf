import { JSDOM } from 'jsdom';
import { setPdfJsLoader, type PdfJs } from '../src/pdf/pdfjs';

// Node no tiene DOMParser: usamos el de jsdom (mismo comportamiento que el navegador para XML).
const { window } = new JSDOM('');
(globalThis as unknown as { DOMParser: typeof window.DOMParser }).DOMParser = window.DOMParser;

// En Node se usa el build "legacy" de pdf.js.
setPdfJsLoader(() => import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfJs>, '');

import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  createSourceFingerprints,
  verifyPdfOutput,
  verifyZipOutput,
} from '../src/integrity/OutputIntegrityValidator';
import { buildPdfs } from '../src/pdf/build';
import { planOutputs, type WorkspacePage } from '../src/pdf/operations';
import { probeWithPdfLib } from '../src/pdf/pdfLibProbe';
import { parseRanges, rangesToPages } from '../src/pdf/ranges';
import { makePdf } from './fixtures/make';

describe('parseRanges', () => {
  it('interpreta intervalos, páginas sueltas y extremos abiertos', () => {
    expect(parseRanges('1-3, 5, 8-', 10).ranges).toEqual([[1, 3], [5, 5], [8, 10]]);
    expect(parseRanges('-2', 10).ranges).toEqual([[1, 2]]);
    expect(rangesToPages([[1, 3], [2, 4]])).toEqual([1, 2, 3, 4]);
  });
  it('rechaza entradas inválidas o fuera de rango', () => {
    expect(parseRanges('', 5).error).toBeTruthy();
    expect(parseRanges('abc', 5).error).toBeTruthy();
    expect(parseRanges('4-2', 5).error).toBeTruthy();
    expect(parseRanges('7', 5).error).toBeTruthy();
    expect(parseRanges('0', 5).error).toBeTruthy();
  });
});

function workspace(spec: Array<[string, number]>): WorkspacePage[] {
  const pages: WorkspacePage[] = [];
  for (const [docId, n] of spec) for (let i = 0; i < n; i++) pages.push({ id: `${docId}-${i}`, docId, pageIndex: i, rotation: 0 });
  return pages;
}
const sources = [
  { id: 'a', name: 'Informe.pdf' },
  { id: 'b', name: 'Anexo.pdf' },
];

describe('planOutputs', () => {
  const pages = workspace([['a', 3], ['b', 2]]);
  it('merge → un documento con todas las páginas en orden', () => {
    const { outputs } = planOutputs({ kind: 'merge' }, pages, sources);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].pages.map((p) => `${p.docId}${p.pageIndex}`)).toEqual(['a0', 'a1', 'a2', 'b0', 'b1']);
  });
  it('separate → un documento por origen, respetando el orden editado', () => {
    const reordered = [pages[4], pages[0], pages[3], pages[2]];
    const { outputs } = planOutputs({ kind: 'separate' }, reordered, sources);
    expect(outputs.map((o) => o.fileName)).toEqual(['Anexo.pdf', 'Informe.pdf']);
    expect(outputs[0].pages.map((p) => p.pageIndex)).toEqual([1, 0]);
  });
  it('split por intervalos y cada N', () => {
    expect(planOutputs({ kind: 'split', mode: 'ranges', ranges: '1-2, 4-' }, pages, sources).outputs.map((o) => o.pages.length)).toEqual([2, 2]);
    expect(planOutputs({ kind: 'split', mode: 'every', every: 2 }, pages, sources).outputs.map((o) => o.pages.length)).toEqual([2, 2, 1]);
    expect(planOutputs({ kind: 'split', mode: 'each' }, pages, sources).outputs).toHaveLength(5);
    expect(planOutputs({ kind: 'split', mode: 'ranges', ranges: '9' }, pages, sources).error).toBeTruthy();
  });
  it('extract → solo las páginas seleccionadas', () => {
    const { outputs } = planOutputs({ kind: 'extract', selected: ['b-1', 'a-0'], asSeparateFiles: false }, pages, sources);
    expect(outputs[0].pages.map((p) => `${p.docId}${p.pageIndex}`)).toEqual(['a0', 'b1']);
  });
});

describe('Generación + validación de salida', () => {
  it('unir, reordenar y rotar produce un PDF verificado', async () => {
    const src = new Map([
      ['a', await makePdf(3, 'Informe')],
      ['b', await makePdf(2, 'Anexo', [842, 595])],
    ]);
    const pages = workspace([['a', 3], ['b', 2]]);
    const edited = [pages[3], pages[0], { ...pages[2], rotation: 90 as const }]; // reordena, elimina y rota
    const { outputs } = planOutputs({ kind: 'merge' }, edited, sources);
    const [bytes] = await buildPdfs(src, outputs);

    const fp = createSourceFingerprints(src);
    const v = await verifyPdfOutput(bytes, outputs[0], fp.get, probeWithPdfLib);
    await fp.dispose();
    expect(v.issues).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.pageCount).toBe(3);
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('detecta un resultado con páginas de menos', async () => {
    const src = new Map([['a', await makePdf(3)]]);
    const spec = { fileName: 'x.pdf', pages: [0, 1, 2].map((i) => ({ docId: 'a', pageIndex: i, rotation: 0 as const })) };
    const [bytes] = await buildPdfs(src, [spec]);
    const doc = await PDFDocument.load(bytes);
    doc.removePage(2);
    const fp = createSourceFingerprints(src);
    const v = await verifyPdfOutput(await doc.save(), spec, fp.get, probeWithPdfLib);
    await fp.dispose();
    expect(v.ok).toBe(false);
    expect(v.sha256).toBeUndefined();
  });

  it('detecta páginas con contenido distinto al esperado', async () => {
    const src = new Map([['a', await makePdf(2)]]);
    const spec = { fileName: 'x.pdf', pages: [0, 1].map((i) => ({ docId: 'a', pageIndex: i, rotation: 0 as const })) };
    const swapped = { fileName: 'x.pdf', pages: [...spec.pages].reverse() };
    const [bytes] = await buildPdfs(src, [swapped]);
    const fp = createSourceFingerprints(src);
    const v = await verifyPdfOutput(bytes, spec, fp.get, probeWithPdfLib);
    await fp.dispose();
    expect(v.ok).toBe(false);
  });

  it('detecta un resultado truncado', async () => {
    const src = new Map([['a', await makePdf(2)]]);
    const spec = { fileName: 'x.pdf', pages: [{ docId: 'a', pageIndex: 0, rotation: 0 as const }] };
    const [bytes] = await buildPdfs(src, [spec]);
    const fp = createSourceFingerprints(src);
    const v = await verifyPdfOutput(bytes.slice(0, bytes.length / 2), spec, fp.get, probeWithPdfLib);
    await fp.dispose();
    expect(v.ok).toBe(false);
  });

  it('verifica el ZIP de resultados y detecta uno alterado', async () => {
    const files = [
      { name: 'a.pdf', bytes: await makePdf(1) },
      { name: 'b.pdf', bytes: await makePdf(2) },
    ];
    const z = new JSZip();
    files.forEach((f) => z.file(f.name, f.bytes));
    const zip = await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    expect((await verifyZipOutput(zip, files)).ok).toBe(true);
    expect((await verifyZipOutput(zip.slice(0, zip.length - 30), files)).ok).toBe(false);
    expect((await verifyZipOutput(zip, [...files, { name: 'c.pdf', bytes: new Uint8Array([1]) }])).ok).toBe(false);
  });
});

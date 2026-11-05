import { describe, expect, it } from 'vitest';
import { validateDocument } from '../src/integrity/DocumentIntegrityEngine';
import { DEFAULT_LIMITS } from '../src/integrity/limits';
import type { DocumentIntegrityReport } from '../src/integrity/types';
import {
  enc,
  makeBrokenPageTreePdf,
  makeDocx,
  makeEncryptedPdf,
  makeJavaScriptPdf,
  makeOleEncrypted,
  makeOleLegacy,
  makePdf,
  makeSimpleRawPdf,
  makeXlsx,
  makeZipBomb,
  patchBytes,
} from './fixtures/make';

const run = (name: string, bytes: Uint8Array, type = '', limits = DEFAULT_LIMITS) =>
  validateDocument({ name, type, bytes }, { limits });

const codes = (r: DocumentIntegrityReport) => r.issues.map((i) => i.code);

describe('Identificación de formato', () => {
  it('rechaza archivos vacíos como CORRUPTED', async () => {
    const r = await run('vacio.pdf', new Uint8Array());
    expect(r.status).toBe('CORRUPTED');
    expect(codes(r)).toContain('EMPTY_FILE');
  });

  it('un .pdf con bytes aleatorios es CORRUPTED (firma inválida)', async () => {
    const r = await run('falso.pdf', enc('esto no es un pdf en absoluto, solo texto'));
    expect(r.status).toBe('CORRUPTED');
    expect(codes(r)).toContain('UNKNOWN_SIGNATURE');
  });

  it('un .txt es UNSUPPORTED', async () => {
    const r = await run('notas.txt', enc('hola'));
    expect(r.status).toBe('UNSUPPORTED');
  });

  it('un DOCX renombrado a .pdf se detecta por su contenido (WARNING)', async () => {
    const r = await run('trabajo.pdf', await makeDocx(), 'application/pdf');
    expect(r.detectedKind).toBe('docx');
    expect(r.status).toBe('WARNING');
    expect(codes(r)).toContain('EXTENSION_MISMATCH');
  });

  it('un PDF renombrado a .docx se trata como PDF (WARNING)', async () => {
    const r = await run('informe.docx', await makePdf(2));
    expect(r.detectedKind).toBe('pdf');
    expect(r.status).toBe('WARNING');
    expect(r.pageCount).toBe(2);
  });

  it('Office cifrado (contenedor OLE con EncryptionInfo) es PROTECTED, no CORRUPTED', async () => {
    const r = await run('secreto.docx', makeOleEncrypted());
    expect(r.status).toBe('PROTECTED');
    expect(codes(r)).toContain('OOXML_ENCRYPTED');
  });

  it('.doc antiguo es UNSUPPORTED', async () => {
    const r = await run('viejo.doc', makeOleLegacy());
    expect(r.status).toBe('UNSUPPORTED');
  });

  it('respeta el tamaño máximo', async () => {
    const r = await run('grande.pdf', await makePdf(1), '', { ...DEFAULT_LIMITS, maxFileBytes: 100 });
    expect(r.status).toBe('UNSUPPORTED');
    expect(codes(r)).toContain('FILE_TOO_LARGE');
  });
});

describe('PDF', () => {
  it('PDF válido → VALID con número de páginas y SHA-256', async () => {
    const r = await run('informe.pdf', await makePdf(3), 'application/pdf');
    expect(r.status).toBe('VALID');
    expect(r.pageCount).toBe(3);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.checks.every((c) => c.passed)).toBe(true);
  });

  it('PDF truncado → CORRUPTED', async () => {
    const full = await makePdf(5);
    const r = await run('cortado.pdf', full.slice(0, Math.floor(full.length * 0.6)));
    expect(r.status).toBe('CORRUPTED');
    expect(codes(r)).toContain('PDF_NO_EOF');
  });

  it('PDF con startxref erróneo → WARNING (reconstruible, nunca VALID)', async () => {
    const r = await run('xref.pdf', makeSimpleRawPdf({ badStartXref: true }));
    expect(r.status).toBe('WARNING');
    expect(codes(r)).toContain('PDF_BAD_XREF_OFFSET');
  });

  it('PDF construido a mano y correcto → VALID', async () => {
    const r = await run('simple.pdf', makeSimpleRawPdf());
    expect(r.status).toBe('VALID');
  });

  it('PDF con contraseña de apertura → PROTECTED', async () => {
    const r = await run('contrato.pdf', makeEncryptedPdf('secreto'));
    expect(r.status).toBe('PROTECTED');
    expect(codes(r)).toContain('PDF_PASSWORD_REQUIRED');
  });

  it('PDF con contraseña de propietario (se ve pero no se edita) → PROTECTED', async () => {
    const r = await run('restringido.pdf', makeEncryptedPdf(''));
    expect(r.status).toBe('PROTECTED');
    expect(codes(r)).toContain('PDF_ENCRYPTED');
  });

  it('árbol de páginas incoherente → CORRUPTED', async () => {
    const r = await run('arbol.pdf', makeBrokenPageTreePdf());
    expect(r.status).toBe('CORRUPTED');
  });

  it('PDF con JavaScript → WARNING (nunca se ejecuta)', async () => {
    const r = await run('js.pdf', makeJavaScriptPdf());
    expect(r.status).toBe('WARNING');
    expect(codes(r)).toContain('PDF_ACTIVE_CONTENT');
  });

  it('cabecera dañada → CORRUPTED', async () => {
    const r = await run('cabecera.pdf', patchBytes(await makePdf(1), '%PDF-', '%XYZ-'));
    expect(r.status).toBe('CORRUPTED');
  });
});

describe('DOCX', () => {
  it('DOCX válido → VALID (con aviso informativo de vínculo externo)', async () => {
    const r = await run('trabajo.docx', await makeDocx());
    expect(r.detectedKind).toBe('docx');
    expect(r.status).toBe('VALID');
    expect(codes(r)).toContain('OOXML_EXTERNAL_LINKS');
  });

  it('falta word/document.xml → CORRUPTED', async () => {
    const r = await run('sin-cuerpo.docx', await makeDocx({ omitDocument: true }));
    expect(r.status).toBe('CORRUPTED');
    expect(codes(r)).toContain('OOXML_MISSING_PART');
  });

  it('XML malformado → CORRUPTED', async () => {
    const r = await run('roto.docx', await makeDocx({ malformedDocument: true }));
    expect(r.status).toBe('CORRUPTED');
    expect(codes(r)).toContain('OOXML_MALFORMED_XML');
  });

  it('relación rota → CORRUPTED', async () => {
    const r = await run('rel.docx', await makeDocx({ brokenRelationship: true }));
    expect(r.status).toBe('CORRUPTED');
    expect(codes(r)).toContain('OOXML_BROKEN_RELATIONSHIP');
  });

  it('macros → WARNING', async () => {
    const r = await run('macro.docm', await makeDocx({ withMacros: true }));
    expect(r.status).toBe('WARNING');
    expect(codes(r)).toContain('OOXML_MACROS');
  });

  it('ZIP truncado → CORRUPTED', async () => {
    const full = await makeDocx();
    const r = await run('cortado.docx', full.slice(0, Math.floor(full.length * 0.7)));
    expect(r.status).toBe('CORRUPTED');
  });

  it('datos internos alterados → CORRUPTED por CRC', async () => {
    const tampered = patchBytes(await makeDocx({ store: true }), 'Hola mundo', 'Hola MUNDO');
    const r = await run('alterado.docx', tampered);
    expect(r.status).toBe('CORRUPTED');
    expect(codes(r)).toContain('ZIP_CRC_MISMATCH');
  });

  it('ZIP bomb → bloqueado sin descomprimirlo entero', async () => {
    const bomb = await makeZipBomb(30 * 1024 * 1024);
    const r = await run('bomba.docx', bomb);
    expect(r.status).toBe('UNSUPPORTED');
    expect(codes(r)).toContain('ZIP_BOMB');
  });

  it('tamaño total descomprimido excesivo → bloqueado', async () => {
    const r = await run('enorme.docx', await makeDocx(), '', { ...DEFAULT_LIMITS, zipMaxUncompressedBytes: 100 });
    expect(codes(r)).toContain('ZIP_BOMB');
  });
});

describe('XLSX', () => {
  it('XLSX válido → VALID con nombres de hojas', async () => {
    const r = await run('datos.xlsx', await makeXlsx());
    expect(r.status).toBe('VALID');
    expect(r.sheetNames).toEqual(['Ventas', 'Resumen']);
  });

  it('fórmulas → aviso informativo', async () => {
    const r = await run('formulas.xlsx', await makeXlsx({ formulas: true }));
    expect(codes(r)).toContain('XLSX_FORMULAS');
  });

  it('libro sin hojas → CORRUPTED', async () => {
    const r = await run('vacio.xlsx', await makeXlsx({ noSheets: true }));
    expect(r.status).toBe('CORRUPTED');
    expect(codes(r)).toContain('XLSX_NO_SHEETS');
  });

  it('hoja referenciada inexistente → CORRUPTED', async () => {
    const r = await run('falta-hoja.xlsx', await makeXlsx({ missingSheet: true }));
    expect(r.status).toBe('CORRUPTED');
  });

  it('XLSX renombrado a .docx → WARNING por tipo incorrecto', async () => {
    const r = await run('datos.docx', await makeXlsx());
    expect(r.detectedKind).toBe('xlsx');
    expect(codes(r)).toContain('OOXML_WRONG_TYPE');
  });
});

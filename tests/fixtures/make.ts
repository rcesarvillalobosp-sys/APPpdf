/**
 * Generadores de documentos de prueba: válidos, corruptos, truncados,
 * protegidos y con extensión incorrecta. Se generan en memoria para que las
 * pruebas sean reproducibles y no dependan de archivos binarios en el repo.
 */
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const enc = (s: string) => new TextEncoder().encode(s);

export async function makePdf(pages: number, label = 'Pagina', size: [number, number] = [595, 842]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage(size);
    p.drawText(`${label} ${i}`, { x: 50, y: size[1] - 80, size: 24, font, color: rgb(0, 0, 0) });
  }
  return doc.save({ useObjectStreams: false });
}

/** Construye un PDF a mano a partir de cuerpos de objetos (con xref correcta). */
export function rawPdf(objects: string[], trailerExtra = '', opts: { badStartXref?: boolean } = {}): Uint8Array {
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra} >>\nstartxref\n${opts.badStartXref ? xrefAt + 7 : xrefAt}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}

// ── Cifrado estándar RC4 40 bits (R2) para generar PDF protegidos ──────────
const PAD = Buffer.from(
  '28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A',
  'hex',
);
function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}
const md5 = (...parts: Buffer[]) => createHash('md5').update(Buffer.concat(parts)).digest();
const pad = (pw: string) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32);
const hex = (b: Buffer) => `<${b.toString('hex')}>`;

/** PDF cifrado. Con userPassword vacío se abre sin contraseña pero tiene restricciones (contraseña de propietario). */
export function makeEncryptedPdf(userPassword: string, ownerPassword = 'propietario'): Uint8Array {
  const id = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const P = -44; // permisos restringidos
  const O = rc4(md5(pad(ownerPassword)).subarray(0, 5), pad(userPassword));
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(P);
  const key = md5(pad(userPassword), O, pBytes, id).subarray(0, 5);
  const U = rc4(key, PAD);
  const objKey = (n: number) => md5(key, Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, 0, 0])).subarray(0, 10);
  const content = rc4(objKey(4), Buffer.from('0 0 1 rg 50 50 200 200 re f', 'latin1'));
  return rawPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R >>',
      `<< /Length ${content.length} >>\nstream\n${content.toString('latin1')}\nendstream`,
      `<< /Filter /Standard /V 1 /R 2 /O ${hex(O)} /U ${hex(U)} /P ${P} >>`,
    ],
    `/Encrypt 5 0 R /ID [${hex(id)} ${hex(id)}]`,
  );
}

/** Árbol de páginas que declara 3 páginas pero solo contiene 1. */
export function makeBrokenPageTreePdf(): Uint8Array {
  return rawPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R >>',
    '<< /Length 27 >>\nstream\n0 0 1 rg 50 50 200 200 re f\nendstream',
  ]);
}

export function makeSimpleRawPdf(opts: { badStartXref?: boolean } = {}): Uint8Array {
  return rawPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R >>',
      '<< /Length 27 >>\nstream\n0 0 1 rg 50 50 200 200 re f\nendstream',
    ],
    '',
    opts,
  );
}

export function makeJavaScriptPdf(): Uint8Array {
  return rawPdf([
    '<< /Type /Catalog /Pages 2 0 R /OpenAction 5 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R >>',
    '<< /Length 27 >>\nstream\n0 0 1 rg 50 50 200 200 re f\nendstream',
    '<< /S /JavaScript /JS (app.alert\\(1\\)) >>',
  ]);
}

// ── Office ─────────────────────────────────────────────────────────────────
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

export interface DocxOptions {
  omitDocument?: boolean;
  malformedDocument?: boolean;
  brokenRelationship?: boolean;
  withMacros?: boolean;
  store?: boolean;
}

export async function makeDocx(o: DocxOptions = {}): Promise<Uint8Array> {
  const z = new JSZip();
  z.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  z.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/></Relationships>`,
  );
  if (!o.omitDocument) {
    z.file(
      'word/document.xml',
      o.malformedDocument
        ? `<?xml version="1.0"?><w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t>Hola mundo</w:t></w:r>`
        : `<?xml version="1.0"?><w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t>Hola mundo DocuFusion</w:t></w:r></w:p></w:body></w:document>`,
    );
  }
  z.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${R_NS}/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>`,
  );
  if (!o.brokenRelationship) z.file('word/styles.xml', `<?xml version="1.0"?><w:styles xmlns:w="${W_NS}"/>`);
  if (o.withMacros) z.file('word/vbaProject.bin', new Uint8Array([1, 2, 3, 4]));
  return z.generateAsync({ type: 'uint8array', compression: o.store ? 'STORE' : 'DEFLATE' });
}

export async function makeXlsx(o: { noSheets?: boolean; formulas?: boolean; missingSheet?: boolean } = {}): Promise<Uint8Array> {
  const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const z = new JSZip();
  z.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
  );
  z.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${OFFICE_DOC}" Target="xl/workbook.xml"/></Relationships>`);
  z.file(
    'xl/workbook.xml',
    `<?xml version="1.0"?><workbook xmlns="${S}" xmlns:r="${R_NS}"><sheets>${o.noSheets ? '' : '<sheet name="Ventas" sheetId="1" r:id="rId1"/><sheet name="Resumen" sheetId="2" r:id="rId2"/>'}</sheets></workbook>`,
  );
  z.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${R_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R_NS}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
  );
  z.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1"><v>10</v></c><c r="B1">${o.formulas ? '<f>A1*2</f>' : ''}<v>20</v></c></row></sheetData></worksheet>`);
  if (!o.missingSheet) z.file('xl/worksheets/sheet2.xml', `<?xml version="1.0"?><worksheet xmlns="${S}"><sheetData/></worksheet>`);
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Un ZIP cuya única entrada son muchos ceros: relación de compresión enorme. */
export async function makeZipBomb(sizeBytes: number, name = 'word/document.xml'): Promise<Uint8Array> {
  const z = new JSZip();
  z.file(name, new Uint8Array(sizeBytes));
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

/** Simula un .docx cifrado: contenedor OLE con flujo EncryptionInfo. */
export function makeOleEncrypted(): Uint8Array {
  const b = new Uint8Array(2048);
  b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  const name = Array.from('EncryptionInfo').flatMap((c) => [c.charCodeAt(0), 0]);
  b.set(name, 1024);
  return b;
}

export function makeOleLegacy(): Uint8Array {
  const b = new Uint8Array(2048);
  b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  return b;
}

/** Reemplaza la primera aparición de `from` por `to` (misma longitud) en los bytes. */
export function patchBytes(b: Uint8Array, from: string, to: string): Uint8Array {
  if (from.length !== to.length) throw new Error('longitudes distintas');
  const out = b.slice();
  const f = enc(from);
  outer: for (let i = 0; i <= out.length - f.length; i++) {
    for (let j = 0; j < f.length; j++) if (out[i + j] !== f[j]) continue outer;
    out.set(enc(to), i);
    return out;
  }
  throw new Error(`no se encontró "${from}"`);
}

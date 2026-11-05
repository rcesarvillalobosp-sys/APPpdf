import type { ZipInspection } from './ZipIntegrityValidator';
import { ReportBuilder } from './types';

/**
 * Validación estructural OOXML (DOCX / XLSX) sobre un ZIP ya verificado:
 * [Content_Types].xml, relaciones, parte principal, XML bien formado,
 * hojas de Excel, macros, vínculos externos y objetos incrustados.
 */

const REL_NS_SUFFIX = '/relationships';
const OFFICE_DOC_REL = /\/officeDocument$/;

export interface OfficeInspection {
  kind: 'docx' | 'xlsx';
  sheetNames?: string[];
  hasFormulas?: boolean;
}

function parseXml(bytes: Uint8Array): Document | null {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return null;
  return doc;
}

function joinPart(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (baseDir ? baseDir.split('/') : []).concat(target.split('/'));
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

function relsPathFor(part: string): string {
  const i = part.lastIndexOf('/');
  return i < 0 ? `_rels/${part}.rels` : `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
}

function dirOf(part: string): string {
  const i = part.lastIndexOf('/');
  return i < 0 ? '' : part.slice(0, i);
}

interface Rel {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

function readRels(doc: Document): Rel[] {
  return Array.from(doc.getElementsByTagName('Relationship')).map((el) => ({
    id: el.getAttribute('Id') ?? '',
    type: el.getAttribute('Type') ?? '',
    target: el.getAttribute('Target') ?? '',
    external: (el.getAttribute('TargetMode') ?? '').toLowerCase() === 'external',
  }));
}

function relIdAttr(el: Element): string | null {
  for (const a of Array.from(el.attributes)) {
    if (a.localName === 'id' && (a.namespaceURI ?? '').endsWith(REL_NS_SUFFIX)) return a.value;
  }
  return null;
}

export function validateOoxml(
  zip: ZipInspection,
  expected: 'docx' | 'xlsx' | 'zip',
  r: ReportBuilder,
): OfficeInspection | null {
  const has = (n: string) => zip.entries.has(n);
  const xmlCache = new Map<string, Document | null>();
  const xml = (n: string): Document | null | undefined => {
    if (xmlCache.has(n)) return xmlCache.get(n);
    const raw = zip.xmlParts.get(n);
    if (!raw) return undefined; // ausente o demasiado grande
    const d = parseXml(raw);
    xmlCache.set(n, d);
    return d;
  };
  const fail = (code: 'OOXML_MISSING_PART' | 'OOXML_MALFORMED_XML' | 'OOXML_BROKEN_RELATIONSHIP', msg: string) => {
    r.add(code, 'error', msg);
    r.mark('CORRUPTED');
    return null;
  };

  // 1. [Content_Types].xml
  if (!has('[Content_Types].xml')) {
    if (expected === 'zip') {
      r.add('UNSUPPORTED_FORMAT', 'error', 'Es un archivo ZIP normal, no un documento de Office.');
      r.mark('UNSUPPORTED');
      return null;
    }
    r.check('[Content_Types].xml presente', false);
    return fail('OOXML_MISSING_PART', 'Falta [Content_Types].xml: el documento de Office está incompleto o dañado.');
  }
  r.check('[Content_Types].xml presente', true);
  const ct = xml('[Content_Types].xml');
  if (!ct) {
    r.check('XML bien formado', false);
    return fail('OOXML_MALFORMED_XML', '[Content_Types].xml contiene XML inválido.');
  }

  // 2. Relación raíz → parte principal.
  const rootRels = xml('_rels/.rels');
  if (!rootRels) {
    r.check('Relaciones raíz (_rels/.rels)', false);
    return rootRels === null
      ? fail('OOXML_MALFORMED_XML', '_rels/.rels contiene XML inválido.')
      : fail('OOXML_MISSING_PART', 'Falta _rels/.rels: no se puede localizar el contenido del documento.');
  }
  r.check('Relaciones raíz (_rels/.rels)', true);
  const mainRel = readRels(rootRels).find((x) => OFFICE_DOC_REL.test(x.type) && !x.external);
  if (!mainRel) {
    return fail('OOXML_BROKEN_RELATIONSHIP', 'No hay relación hacia el documento principal.');
  }
  const mainPart = joinPart('', mainRel.target);
  if (!has(mainPart)) {
    r.check('Parte principal presente', false);
    return fail('OOXML_MISSING_PART', `Falta la parte principal "${mainPart}".`);
  }
  r.check('Parte principal presente', true);

  const kind: 'docx' | 'xlsx' | null = mainPart.startsWith('word/')
    ? 'docx'
    : mainPart.startsWith('xl/')
      ? 'xlsx'
      : null;
  if (!kind) {
    r.add('UNSUPPORTED_FORMAT', 'error', 'Documento de Office no compatible (solo Word y Excel).');
    r.mark('UNSUPPORTED');
    return null;
  }
  if (expected !== 'zip' && expected !== kind) {
    r.add(
      'OOXML_WRONG_TYPE',
      'warning',
      `El archivo tiene extensión de ${expected === 'docx' ? 'Word' : 'Excel'} pero en realidad es un documento de ${kind === 'docx' ? 'Word' : 'Excel'}.`,
    );
  }

  // 3. Content type de la parte principal.
  const overrides = Array.from(ct.getElementsByTagName('Override'));
  const mainCt = overrides.find((o) => (o.getAttribute('PartName') ?? '').replace(/^\//, '') === mainPart);
  r.check('Tipo de contenido de la parte principal', !!mainCt);
  if (!mainCt) {
    r.add('OOXML_MISSING_PART', 'warning', 'La parte principal no está registrada en [Content_Types].xml.');
  }

  // 4. Todas las partes XML deben estar bien formadas.
  let malformed: string | null = null;
  for (const name of zip.xmlParts.keys()) {
    if (xml(name) === null) {
      malformed = name;
      break;
    }
  }
  r.check('XML bien formado', malformed === null);
  if (malformed) return fail('OOXML_MALFORMED_XML', `La parte "${malformed}" contiene XML inválido o truncado.`);

  const main = xml(mainPart);
  if (!main) {
    return fail('OOXML_MISSING_PART', `No se pudo leer la parte principal "${mainPart}".`);
  }

  // 5. Relaciones de la parte principal: cada destino interno debe existir.
  const mainRelsPath = relsPathFor(mainPart);
  const mainRelsDoc = xml(mainRelsPath);
  const mainRels = mainRelsDoc ? readRels(mainRelsDoc) : [];
  let broken: string | null = null;
  let externals = 0;
  for (const rel of mainRels) {
    if (rel.external) {
      externals++;
      continue;
    }
    if (!has(joinPart(dirOf(mainPart), rel.target))) {
      broken = rel.target;
      break;
    }
  }
  r.check('Relaciones internas', broken === null);
  if (broken) return fail('OOXML_BROKEN_RELATIONSHIP', `La relación hacia "${broken}" apunta a una parte inexistente.`);
  if (externals > 0) {
    r.add(
      'OOXML_EXTERNAL_LINKS',
      'info',
      `Contiene ${externals} vínculo(s) externo(s). No se abrirán ni se descargarán.`,
    );
  }

  // 6. Contenido activo e incrustado.
  const names = Array.from(zip.entries.keys());
  if (names.some((n) => /vbaProject\.bin$/i.test(n))) {
    r.add(
      'OOXML_MACROS',
      'warning',
      'Contiene macros. Nunca se ejecutan aquí y se descartarán en los documentos generados.',
    );
  }
  if (names.some((n) => /\/(embeddings|activeX)\//i.test(n))) {
    r.add('OOXML_EMBEDDED_OBJECTS', 'info', 'Contiene objetos incrustados que podrían no conservarse al convertir.');
  }

  // 7. Comprobaciones específicas por formato.
  if (kind === 'docx') {
    const body = main.getElementsByTagNameNS('*', 'body');
    r.check('Cuerpo del documento (w:body)', body.length > 0);
    if (body.length === 0) return fail('OOXML_MISSING_PART', 'word/document.xml no contiene el cuerpo del documento.');
    return { kind };
  }

  const sheets = Array.from(main.getElementsByTagNameNS('*', 'sheet'));
  r.check('El libro contiene hojas', sheets.length > 0);
  if (sheets.length === 0) {
    r.add('XLSX_NO_SHEETS', 'error', 'El libro de Excel no contiene ninguna hoja.');
    r.mark('CORRUPTED');
    return null;
  }
  const relById = new Map(mainRels.map((x) => [x.id, x]));
  const sheetNames: string[] = [];
  let hasFormulas = false;
  for (const s of sheets) {
    const name = s.getAttribute('name') ?? '(sin nombre)';
    sheetNames.push(name);
    const rid = relIdAttr(s);
    const rel = rid ? relById.get(rid) : undefined;
    if (!rel) return fail('OOXML_BROKEN_RELATIONSHIP', `La hoja "${name}" no tiene relación válida.`);
    const part = joinPart(dirOf(mainPart), rel.target);
    if (!has(part)) return fail('OOXML_MISSING_PART', `Falta la hoja "${name}" (${part}).`);
    const sheetDoc = xml(part);
    if (sheetDoc && sheetDoc.getElementsByTagNameNS('*', 'f').length > 0) hasFormulas = true;
  }
  r.check('Todas las hojas existen', true);
  if (hasFormulas) {
    r.add(
      'XLSX_FORMULAS',
      'info',
      'Contiene fórmulas. Al exportar a PDF se mostrarán sus valores calculados, no las fórmulas.',
    );
  }
  return { kind, sheetNames, hasFormulas };
}

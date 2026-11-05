import { crc32Update } from './crc32';
import type { ProcessingLimits } from './limits';
import { ReportBuilder } from './types';

/**
 * Validador de contenedores ZIP (DOCX, XLSX, ZIP).
 *
 * No delega en una librería: lee el directorio central, comprueba cada cabecera
 * local, descomprime cada entrada con un límite estricto de bytes (anti ZIP bomb)
 * y verifica su CRC-32. Así detecta archivos truncados, entradas dañadas y
 * tamaños declarados falsos.
 */

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface ZipInspection {
  entries: Map<string, ZipEntry>;
  /** Contenido descomprimido y verificado de las partes XML/.rels (para el validador OOXML). */
  xmlParts: Map<string, Uint8Array>;
  totalUncompressed: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}
function u64(b: Uint8Array, o: number): number {
  // Suficiente hasta 2^53; ningún archivo del navegador se acerca.
  return u32(b, o) + u32(b, o + 4) * 0x100000000;
}

class ZipStructureError extends Error {
  constructor(
    readonly code: 'ZIP_NO_EOCD' | 'ZIP_TRUNCATED' | 'ZIP_CENTRAL_DIRECTORY',
    message: string,
  ) {
    super(message);
  }
}

function findEocd(b: Uint8Array): number {
  // EOCD = 22 bytes + comentario de hasta 65535 bytes.
  const min = Math.max(0, b.length - 22 - 0xffff);
  for (let i = b.length - 22; i >= min; i--) {
    if (u32(b, i) === SIG_EOCD) return i;
  }
  return -1;
}

/** Lee el directorio central. Lanza ZipStructureError si la estructura es inválida. */
export function readCentralDirectory(b: Uint8Array): ZipEntry[] {
  const eocd = findEocd(b);
  if (eocd < 0) {
    throw new ZipStructureError(
      'ZIP_NO_EOCD',
      'No se encontró el final del contenedor ZIP: el archivo está truncado o dañado.',
    );
  }
  let total = u16(b, eocd + 10);
  let cdSize = u32(b, eocd + 12);
  let cdOffset = u32(b, eocd + 16);

  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || u32(b, loc) !== SIG_ZIP64_LOCATOR) {
      throw new ZipStructureError('ZIP_CENTRAL_DIRECTORY', 'Falta el localizador ZIP64.');
    }
    const z64 = u64(b, loc + 8);
    if (z64 + 56 > b.length || u32(b, z64) !== SIG_ZIP64_EOCD) {
      throw new ZipStructureError('ZIP_CENTRAL_DIRECTORY', 'Registro ZIP64 dañado.');
    }
    total = u64(b, z64 + 32);
    cdSize = u64(b, z64 + 40);
    cdOffset = u64(b, z64 + 48);
  }

  if (cdOffset + cdSize > b.length || cdOffset + cdSize > eocd + 0) {
    throw new ZipStructureError(
      'ZIP_TRUNCATED',
      'El directorio central del ZIP apunta fuera del archivo: el archivo está incompleto.',
    );
  }

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > b.length || u32(b, p) !== SIG_CENTRAL) {
      throw new ZipStructureError(
        'ZIP_CENTRAL_DIRECTORY',
        `Entrada ${i + 1} del directorio central dañada.`,
      );
    }
    const flags = u16(b, p + 8);
    const method = u16(b, p + 10);
    const crc = u32(b, p + 16);
    let compressedSize = u32(b, p + 20);
    let uncompressedSize = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    let localHeaderOffset = u32(b, p + 42);
    if (p + 46 + nameLen + extraLen + commentLen > b.length) {
      throw new ZipStructureError('ZIP_TRUNCATED', 'Directorio central incompleto.');
    }
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));

    // Campo extra ZIP64 (id 0x0001).
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = u16(b, x);
      const sz = u16(b, x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (uncompressedSize === 0xffffffff) (uncompressedSize = u64(b, q)), (q += 8);
        if (compressedSize === 0xffffffff) (compressedSize = u64(b, q)), (q += 8);
        if (localHeaderOffset === 0xffffffff) localHeaderOffset = u64(b, q);
      }
      x += 4 + sz;
    }

    entries.push({ name, method, flags, crc, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Desplazamiento donde empiezan los datos de la entrada, validando la cabecera local. */
function dataStart(b: Uint8Array, e: ZipEntry): number {
  const o = e.localHeaderOffset;
  if (o + 30 > b.length || u32(b, o) !== SIG_LOCAL) {
    throw new ZipStructureError('ZIP_CENTRAL_DIRECTORY', `Cabecera local de "${e.name}" no encontrada.`);
  }
  const start = o + 30 + u16(b, o + 26) + u16(b, o + 28);
  if (start + e.compressedSize > b.length) {
    throw new ZipStructureError('ZIP_TRUNCATED', `Los datos de "${e.name}" están incompletos (archivo truncado).`);
  }
  return start;
}

export class InflateLimitError extends Error {}

/**
 * Descomprime una entrada sin superar nunca `maxBytes` y devuelve los bytes y su CRC.
 * Si `keep` es false descarta los datos (solo calcula CRC), para no ocupar memoria.
 */
async function inflateEntry(
  raw: Uint8Array,
  method: number,
  maxBytes: number,
  keep: boolean,
): Promise<{ data: Uint8Array | null; size: number; crc: number }> {
  if (method === 0) {
    if (raw.length > maxBytes) throw new InflateLimitError();
    return { data: keep ? raw : null, size: raw.length, crc: crc32Update(0, raw) };
  }
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(ds);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let crc = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new InflateLimitError();
    }
    crc = crc32Update(crc, value);
    if (keep) chunks.push(value);
  }
  if (!keep) return { data: null, size, crc };
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) out.set(c, off), (off += c.length);
  return { data: out, size, crc };
}

function isUnsafePath(name: string): boolean {
  return name.startsWith('/') || name.startsWith('\\') || /(^|[\\/])\.\.([\\/]|$)/.test(name) || /^[a-zA-Z]:/.test(name);
}

/**
 * Inspección completa. Devuelve null si el contenedor no es utilizable
 * (el informe ya contiene el motivo y el estado).
 */
export async function inspectZip(
  bytes: Uint8Array,
  limits: ProcessingLimits,
  r: ReportBuilder,
  keepPart: (name: string) => boolean = (n) => /\.(xml|rels)$/i.test(n),
): Promise<ZipInspection | null> {
  let list: ZipEntry[];
  try {
    list = readCentralDirectory(bytes);
    r.check('Directorio central ZIP', true);
  } catch (e) {
    r.check('Directorio central ZIP', false);
    if (e instanceof ZipStructureError) r.add(e.code, 'error', e.message);
    else r.add('ZIP_CENTRAL_DIRECTORY', 'error', 'Contenedor ZIP ilegible.', String(e));
    r.mark('CORRUPTED');
    return null;
  }

  if (list.length > limits.zipMaxEntries) {
    r.add('ZIP_TOO_MANY_ENTRIES', 'error', `El contenedor tiene demasiadas entradas (${list.length}).`);
    r.mark('UNSUPPORTED');
    return null;
  }

  // Comprobación previa de tamaños declarados (barata) antes de descomprimir nada.
  let declared = 0;
  for (const e of list) {
    declared += e.uncompressedSize;
    if (e.flags & 0x1) {
      r.add('ZIP_ENCRYPTED_ENTRY', 'error', `La entrada "${e.name}" está cifrada.`);
      r.mark('PROTECTED');
      return null;
    }
    if (isUnsafePath(e.name)) {
      r.add('ZIP_UNSAFE_PATH', 'error', `Ruta interna sospechosa: "${e.name}".`);
      r.mark('CORRUPTED');
      return null;
    }
  }
  if (declared > limits.zipMaxUncompressedBytes) {
    r.add(
      'ZIP_BOMB',
      'error',
      'El contenido descomprimido sería demasiado grande. Por seguridad no se procesará (posible ZIP bomb).',
    );
    r.mark('UNSUPPORTED');
    return null;
  }

  const entries = new Map<string, ZipEntry>();
  const xmlParts = new Map<string, Uint8Array>();
  let totalUncompressed = 0;

  for (const e of list) {
    entries.set(e.name, e);
    if (e.name.endsWith('/')) continue; // directorio
    if (e.method !== 0 && e.method !== 8) {
      r.add('ZIP_CENTRAL_DIRECTORY', 'error', `"${e.name}" usa un método de compresión no estándar (${e.method}).`);
      r.mark('UNSUPPORTED');
      return null;
    }
    let start: number;
    try {
      start = dataStart(bytes, e);
    } catch (err) {
      r.check('Cabeceras locales ZIP', false);
      if (err instanceof ZipStructureError) r.add(err.code, 'error', err.message);
      r.mark('CORRUPTED');
      return null;
    }

    // Límite por entrada: nunca más de lo declarado (un tamaño falso es corrupción)
    // ni más de lo que permite el ratio de compresión.
    const ratioCap =
      e.compressedSize * limits.zipMaxRatio > limits.zipRatioMinBytes
        ? e.compressedSize * limits.zipMaxRatio
        : limits.zipRatioMinBytes;
    const cap = Math.min(e.uncompressedSize, limits.zipMaxUncompressedBytes - totalUncompressed);
    if (e.uncompressedSize > ratioCap) {
      r.add(
        'ZIP_BOMB',
        'error',
        `La entrada "${e.name}" tiene una tasa de compresión anómala. Por seguridad no se procesará (posible ZIP bomb).`,
      );
      r.mark('UNSUPPORTED');
      return null;
    }

    const keep = keepPart(e.name) && e.uncompressedSize <= limits.maxXmlBytes;
    try {
      const res = await inflateEntry(bytes.subarray(start, start + e.compressedSize), e.method, cap, keep);
      if (res.size !== e.uncompressedSize || res.crc !== e.crc) {
        r.check('CRC-32 de las entradas', false);
        r.add(
          'ZIP_CRC_MISMATCH',
          'error',
          `La parte interna "${e.name}" está dañada (la suma de verificación CRC no coincide).`,
          `CRC esperado ${e.crc.toString(16)}, obtenido ${res.crc.toString(16)}; tamaño esperado ${e.uncompressedSize}, obtenido ${res.size}.`,
        );
        r.mark('CORRUPTED');
        return null;
      }
      totalUncompressed += res.size;
      if (res.data) xmlParts.set(e.name, res.data);
    } catch (err) {
      r.check('CRC-32 de las entradas', false);
      if (err instanceof InflateLimitError) {
        r.add(
          'ZIP_CRC_MISMATCH',
          'error',
          `La parte interna "${e.name}" ocupa más de lo que declara: contenedor dañado o manipulado.`,
        );
      } else {
        r.add('ZIP_CRC_MISMATCH', 'error', `No se pudo descomprimir "${e.name}": datos dañados.`, String(err));
      }
      r.mark('CORRUPTED');
      return null;
    }
  }
  r.check('CRC-32 de las entradas', true);
  return { entries, xmlParts, totalUncompressed };
}

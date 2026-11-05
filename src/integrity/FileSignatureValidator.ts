import { ReportBuilder, type DocumentKind } from './types';

/**
 * Identifica el formato REAL por sus bytes (magic bytes), y lo compara con
 * la extensión y el MIME declarados. Nunca se confía solo en la extensión.
 */

export interface SignatureResult {
  /** Tipo según el contenido binario. 'zip' = contenedor ZIP aún sin clasificar. */
  binaryKind: 'pdf' | 'zip' | 'ole' | 'unknown';
  /** Tipo según extensión. */
  extensionKind: DocumentKind;
  /** Desplazamiento de "%PDF-" (los PDF pueden tener basura antes de la cabecera). */
  pdfHeaderOffset?: number;
  /** El archivo OLE contiene un flujo EncryptionInfo (OOXML cifrado con contraseña). */
  oleEncryptedOoxml?: boolean;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06]; // ZIP vacío
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[offset + i] !== magic[i]) return false;
  return true;
}

export function indexOfBytes(hay: Uint8Array, needle: number[], from = 0, to = hay.length): number {
  const end = Math.min(to, hay.length) - needle.length;
  outer: for (let i = Math.max(0, from); i <= end; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function extensionOf(name: string): string {
  const m = /\.([^./\\]+)$/.exec(name.toLowerCase());
  return m ? m[1] : '';
}

export function kindFromExtension(name: string): DocumentKind {
  switch (extensionOf(name)) {
    case 'pdf':
      return 'pdf';
    case 'docx':
    case 'docm':
      return 'docx';
    case 'xlsx':
    case 'xlsm':
      return 'xlsx';
    case 'zip':
      return 'zip';
    case 'doc':
    case 'xls':
      return 'ole';
    default:
      return 'unknown';
  }
}

const MIME_KIND: Record<string, DocumentKind> = {
  'application/pdf': 'pdf',
  'application/x-pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-word.document.macroenabled.12': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'xlsx',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/msword': 'ole',
  'application/vnd.ms-excel': 'ole',
};

/** UTF-16LE de "EncryptionInfo" — nombre de flujo en OOXML cifrado. */
const ENCRYPTION_INFO_UTF16 = Array.from('EncryptionInfo').flatMap((c) => [c.charCodeAt(0), 0]);

export function detectSignature(bytes: Uint8Array, name: string): SignatureResult {
  const extensionKind = kindFromExtension(name);
  if (startsWith(bytes, ZIP_MAGIC) || startsWith(bytes, ZIP_EMPTY)) {
    return { binaryKind: 'zip', extensionKind };
  }
  if (startsWith(bytes, OLE_MAGIC)) {
    return {
      binaryKind: 'ole',
      extensionKind,
      oleEncryptedOoxml: indexOfBytes(bytes, ENCRYPTION_INFO_UTF16, 0, Math.min(bytes.length, 4 * 1024 * 1024)) >= 0,
    };
  }
  // La especificación permite hasta 1024 bytes de basura antes de %PDF-.
  const pdfAt = indexOfBytes(bytes, PDF_MAGIC, 0, 1024 + PDF_MAGIC.length);
  if (pdfAt >= 0) return { binaryKind: 'pdf', extensionKind, pdfHeaderOffset: pdfAt };
  return { binaryKind: 'unknown', extensionKind };
}

/**
 * Registra en el informe las discrepancias de extensión / MIME.
 * Devuelve false si el archivo debe descartarse ya (desconocido, OLE, etc.).
 */
export function validateSignature(
  sig: SignatureResult,
  name: string,
  mime: string,
  r: ReportBuilder,
): boolean {
  const ext = extensionOf(name) || '(sin extensión)';

  if (sig.binaryKind === 'unknown') {
    r.check('Firma binaria reconocida', false);
    if (sig.extensionKind !== 'unknown' && sig.extensionKind !== 'ole') {
      // Dice ser PDF/DOCX/XLSX pero sus bytes no lo son: dañado o falso.
      r.add(
        'UNKNOWN_SIGNATURE',
        'error',
        `El contenido no corresponde a un archivo .${ext}: la firma binaria no es válida.`,
        'Los primeros bytes no coinciden con %PDF- ni con un contenedor ZIP (PK).',
      );
      r.mark('CORRUPTED');
    } else {
      r.add('UNSUPPORTED_FORMAT', 'error', `Formato no compatible (.${ext}).`);
      r.mark('UNSUPPORTED');
    }
    return false;
  }
  r.check('Firma binaria reconocida', true);

  if (sig.binaryKind === 'ole') {
    if (sig.oleEncryptedOoxml) {
      r.add(
        'OOXML_ENCRYPTED',
        'error',
        'El documento de Office está cifrado con contraseña. Ábrelo en Office, quita la contraseña y vuelve a subirlo.',
      );
      r.mark('PROTECTED');
    } else {
      r.add(
        'LEGACY_OFFICE_FORMAT',
        'error',
        'Formato antiguo de Office (.doc/.xls) no compatible. Guárdalo como .docx o .xlsx.',
      );
      r.mark('UNSUPPORTED');
    }
    return false;
  }

  // Extensión vs contenido.
  const extOk =
    (sig.binaryKind === 'pdf' && sig.extensionKind === 'pdf') ||
    (sig.binaryKind === 'zip' && ['docx', 'xlsx', 'zip'].includes(sig.extensionKind));
  // Una discrepancia de extensión es una advertencia, no un fallo estructural.
  r.check('La extensión coincide con el contenido', extOk, !extOk);
  if (!extOk) {
    const real = sig.binaryKind === 'pdf' ? 'un PDF' : 'un contenedor ZIP (Office/ZIP)';
    r.add(
      'EXTENSION_MISMATCH',
      'warning',
      `La extensión .${ext} no coincide con el contenido real: el archivo es ${real}. Se tratará según su contenido.`,
    );
  }

  const mimeKind = MIME_KIND[mime.toLowerCase()];
  if (mime && mimeKind && mimeKind !== 'ole') {
    const mimeOk =
      (sig.binaryKind === 'pdf' && mimeKind === 'pdf') || (sig.binaryKind === 'zip' && mimeKind !== 'pdf');
    if (!mimeOk) {
      r.add('MIME_MISMATCH', 'info', `El tipo MIME declarado (${mime}) no coincide con el contenido.`);
    }
  }
  return true;
}

/**
 * EBCDIC ↔ Unicode translation with pluggable code page support.
 */

import { EBCDIC_TO_UNICODE, UNICODE_TO_EBCDIC } from './codepages/cp037';

export interface CodePage {
  readonly ebcdicToUnicode: Uint16Array;
  readonly unicodeToEbcdic: Uint8Array;
}

/** Code Page 037 (US/Canada) — the default code page. */
export const CP037: CodePage = {
  ebcdicToUnicode: EBCDIC_TO_UNICODE,
  unicodeToEbcdic: UNICODE_TO_EBCDIC,
};

/** Registry of available code pages. */
const CODE_PAGES: Map<string, CodePage> = new Map([['CP037', CP037]]);

/**
 * Get a code page by name. Falls back to CP037 if not found.
 */
export function getCodePage(name: string): CodePage {
  return CODE_PAGES.get(name.toUpperCase()) ?? CP037;
}

/**
 * Register a new code page for use by the codec.
 */
export function registerCodePage(name: string, codePage: CodePage): void {
  CODE_PAGES.set(name.toUpperCase(), codePage);
}

/**
 * Decode an EBCDIC byte buffer to a Unicode string.
 */
export function decode(
  buffer: Uint8Array,
  codePage: CodePage = CP037,
): string {
  const chars: string[] = new Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    chars[i] = String.fromCharCode(codePage.ebcdicToUnicode[buffer[i]]);
  }
  return chars.join('');
}

/**
 * Encode a Unicode string to an EBCDIC byte buffer.
 * Characters outside the code page's mapping become 0x3F (EBCDIC '?').
 */
export function encode(
  str: string,
  codePage: CodePage = CP037,
): Uint8Array {
  const buffer = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);
    buffer[i] = cp < 256 ? codePage.unicodeToEbcdic[cp] : 0x3F;
  }
  return buffer;
}

/**
 * Decode a single EBCDIC byte to a Unicode character.
 */
export function decodeChar(
  byte: number,
  codePage: CodePage = CP037,
): string {
  return String.fromCharCode(codePage.ebcdicToUnicode[byte & 0xFF]);
}

/**
 * Encode a single Unicode character to an EBCDIC byte.
 */
export function encodeChar(
  char: string,
  codePage: CodePage = CP037,
): number {
  const cp = char.charCodeAt(0);
  return cp < 256 ? codePage.unicodeToEbcdic[cp] : 0x3F;
}

import { decode, encode, decodeChar, encodeChar, getCodePage, CP037 } from '../../../src/protocol/ebcdic';
import { EBCDIC_TO_UNICODE, UNICODE_TO_EBCDIC } from '../../../src/protocol/codepages/cp037';

describe('CP037 translation table', () => {
  it('should have 256 entries in EBCDIC→Unicode table', () => {
    expect(EBCDIC_TO_UNICODE.length).toBe(256);
  });

  it('should have 256 entries in Unicode→EBCDIC table', () => {
    expect(UNICODE_TO_EBCDIC.length).toBe(256);
  });

  it('should round-trip all printable ASCII characters', () => {
    const printable = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (const ch of printable) {
      const ebcdic = UNICODE_TO_EBCDIC[ch.charCodeAt(0)];
      const unicode = EBCDIC_TO_UNICODE[ebcdic];
      expect(String.fromCharCode(unicode)).toBe(ch);
    }
  });

  it('should map EBCDIC space (0x40) to Unicode space (0x20)', () => {
    expect(EBCDIC_TO_UNICODE[0x40]).toBe(0x20);
  });

  it('should map common special characters correctly', () => {
    // Period
    expect(EBCDIC_TO_UNICODE[0x4B]).toBe(0x2E); // '.'
    // Comma
    expect(EBCDIC_TO_UNICODE[0x6B]).toBe(0x2C); // ','
    // Slash
    expect(EBCDIC_TO_UNICODE[0x61]).toBe(0x2F); // '/'
    // Open paren
    expect(EBCDIC_TO_UNICODE[0x4D]).toBe(0x28); // '('
    // Close paren
    expect(EBCDIC_TO_UNICODE[0x5D]).toBe(0x29); // ')'
    // Plus
    expect(EBCDIC_TO_UNICODE[0x4E]).toBe(0x2B); // '+'
    // Minus/hyphen
    expect(EBCDIC_TO_UNICODE[0x60]).toBe(0x2D); // '-'
    // Equals
    expect(EBCDIC_TO_UNICODE[0x7E]).toBe(0x3D); // '='
    // Ampersand
    expect(EBCDIC_TO_UNICODE[0x50]).toBe(0x26); // '&'
  });

  it('should map EBCDIC digits (0xF0-0xF9) to ASCII digits', () => {
    for (let d = 0; d <= 9; d++) {
      expect(EBCDIC_TO_UNICODE[0xF0 + d]).toBe(0x30 + d);
    }
  });

  it('should map EBCDIC uppercase letters correctly', () => {
    // A-I: 0xC1-0xC9
    for (let i = 0; i < 9; i++) {
      expect(String.fromCharCode(EBCDIC_TO_UNICODE[0xC1 + i])).toBe(
        String.fromCharCode(0x41 + i),
      );
    }
    // J-R: 0xD1-0xD9
    for (let i = 0; i < 9; i++) {
      expect(String.fromCharCode(EBCDIC_TO_UNICODE[0xD1 + i])).toBe(
        String.fromCharCode(0x4A + i),
      );
    }
    // S-Z: 0xE2-0xE9
    for (let i = 0; i < 8; i++) {
      expect(String.fromCharCode(EBCDIC_TO_UNICODE[0xE2 + i])).toBe(
        String.fromCharCode(0x53 + i),
      );
    }
  });

  it('should map EBCDIC lowercase letters correctly', () => {
    // a-i: 0x81-0x89
    for (let i = 0; i < 9; i++) {
      expect(String.fromCharCode(EBCDIC_TO_UNICODE[0x81 + i])).toBe(
        String.fromCharCode(0x61 + i),
      );
    }
    // j-r: 0x91-0x99
    for (let i = 0; i < 9; i++) {
      expect(String.fromCharCode(EBCDIC_TO_UNICODE[0x91 + i])).toBe(
        String.fromCharCode(0x6A + i),
      );
    }
    // s-z: 0xA2-0xA9
    for (let i = 0; i < 8; i++) {
      expect(String.fromCharCode(EBCDIC_TO_UNICODE[0xA2 + i])).toBe(
        String.fromCharCode(0x73 + i),
      );
    }
  });

  it('should map EBCDIC null (0x00) to Unicode null (0x00)', () => {
    expect(EBCDIC_TO_UNICODE[0x00]).toBe(0x00);
  });
});

describe('decode', () => {
  it('should decode EBCDIC buffer to Unicode string', () => {
    // "HELLO" in EBCDIC CP037
    const hello = new Uint8Array([0xC8, 0xC5, 0xD3, 0xD3, 0xD6]);
    expect(decode(hello)).toBe('HELLO');
  });

  it('should decode empty buffer to empty string', () => {
    expect(decode(new Uint8Array(0))).toBe('');
  });

  it('should decode mixed content', () => {
    // "Hi 1" in EBCDIC
    const buf = new Uint8Array([0xC8, 0x89, 0x40, 0xF1]);
    expect(decode(buf)).toBe('Hi 1');
  });

  it('should handle null bytes', () => {
    const buf = new Uint8Array([0x00, 0xC8, 0x00]);
    const result = decode(buf);
    expect(result.length).toBe(3);
    expect(result[1]).toBe('H');
  });
});

describe('encode', () => {
  it('should encode Unicode string to EBCDIC buffer', () => {
    const result = encode('HELLO');
    expect(Array.from(result)).toEqual([0xC8, 0xC5, 0xD3, 0xD3, 0xD6]);
  });

  it('should encode empty string to empty buffer', () => {
    expect(encode('').length).toBe(0);
  });

  it('should encode digits correctly', () => {
    const result = encode('0123456789');
    for (let i = 0; i < 10; i++) {
      expect(result[i]).toBe(0xF0 + i);
    }
  });

  it('should map unmappable Unicode chars to 0x3F (question mark)', () => {
    // Unicode emoji — outside Latin-1, should become EBCDIC '?'
    const result = encode('\u2603'); // snowman
    expect(result[0]).toBe(0x3F);
  });

  it('should round-trip printable ASCII via encode→decode', () => {
    const original = 'Hello, World! 123 @#$';
    const encoded = encode(original);
    const decoded = decode(encoded);
    expect(decoded).toBe(original);
  });
});

describe('decodeChar', () => {
  it('should decode a single EBCDIC byte', () => {
    expect(decodeChar(0xC8)).toBe('H');
    expect(decodeChar(0x40)).toBe(' ');
    expect(decodeChar(0xF0)).toBe('0');
  });

  it('should mask to 8 bits', () => {
    expect(decodeChar(0x1C8)).toBe('H'); // 0x1C8 & 0xFF = 0xC8
  });
});

describe('encodeChar', () => {
  it('should encode a single Unicode character', () => {
    expect(encodeChar('H')).toBe(0xC8);
    expect(encodeChar(' ')).toBe(0x40);
    expect(encodeChar('0')).toBe(0xF0);
  });

  it('should return 0x3F for unmappable characters', () => {
    expect(encodeChar('\u2603')).toBe(0x3F);
  });
});

describe('getCodePage', () => {
  it('should return CP037 for "CP037"', () => {
    expect(getCodePage('CP037')).toBe(CP037);
  });

  it('should be case-insensitive', () => {
    expect(getCodePage('cp037')).toBe(CP037);
  });

  it('should fall back to CP037 for unknown code pages', () => {
    expect(getCodePage('CP500')).toBe(CP037);
  });
});

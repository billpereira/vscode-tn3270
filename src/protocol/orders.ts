/**
 * 3270 orders: SBA, SF, SFE, SA, MF, IC, PT, RA, EUA, GE.
 *
 * Each order is parsed from the datastream and applied to a ScreenBuffer.
 * Reference: IBM 3270 Data Stream Reference (GA23-0059)
 */

import { ScreenBuffer } from '../emulator/screen-buffer';
import { ExtendedAttrType, Color, Highlight } from '../emulator/field';

// ── Order codes ─────────────────────────────────────────────────────

export const OrderCode = {
  SBA: 0x11,  // Set Buffer Address
  SF:  0x1D,  // Start Field
  SFE: 0x29,  // Start Field Extended
  SA:  0x28,  // Set Attribute
  MF:  0x2C,  // Modify Field
  IC:  0x13,  // Insert Cursor
  PT:  0x05,  // Program Tab
  RA:  0x3C,  // Repeat to Address
  EUA: 0x12,  // Erase Unprotected to Address
  GE:  0x08,  // Graphic Escape
} as const;

// ── Buffer address decoding ─────────────────────────────────────────

/**
 * Decode a 2-byte 3270 buffer address.
 *
 * 3270 uses two encoding formats:
 * - 14-bit: if bits 0-1 of first byte are 00, the address is
 *   ((b1 & 0x3F) << 8) | b2
 * - 12-bit (legacy): bits 0-1 of first byte are non-00,
 *   uses a 6-bit encoding per byte via the address table
 */
export function decodeAddress(b1: number, b2: number): number {
  if ((b1 & 0xC0) === 0x00) {
    // 14-bit addressing
    return ((b1 & 0x3F) << 8) | b2;
  }
  // 12-bit addressing (6 bits from each byte)
  return (ADDRESS_TABLE[b1 & 0x3F] << 6) | ADDRESS_TABLE[b2 & 0x3F];
}

/**
 * Encode a buffer address as 2 bytes (14-bit format).
 */
export function encodeAddress(address: number): [number, number] {
  return [(address >> 8) & 0x3F, address & 0xFF];
}

/** 6-bit to value lookup for 12-bit address decoding. */
const ADDRESS_TABLE: number[] = (() => {
  const t = new Array(64).fill(0);
  for (let i = 0; i < 64; i++) {
    t[i] = i;
  }
  return t;
})();

// ── Order processing ────────────────────────────────────────────────

/** Result of processing orders — how many bytes were consumed. */
export interface OrderResult {
  bytesConsumed: number;
}

/**
 * Check if a byte is a 3270 order code.
 */
export function isOrder(byte: number): boolean {
  return (
    byte === OrderCode.SBA ||
    byte === OrderCode.SF ||
    byte === OrderCode.SFE ||
    byte === OrderCode.SA ||
    byte === OrderCode.MF ||
    byte === OrderCode.IC ||
    byte === OrderCode.PT ||
    byte === OrderCode.RA ||
    byte === OrderCode.EUA ||
    byte === OrderCode.GE
  );
}

/**
 * Process a single order from the datastream buffer.
 *
 * @param data The full datastream buffer
 * @param offset Position of the order byte
 * @param screen The screen buffer to modify
 * @returns Number of bytes consumed (including the order byte)
 */
export function processOrder(
  data: Buffer,
  offset: number,
  screen: ScreenBuffer,
): number {
  const order = data[offset];

  switch (order) {
    case OrderCode.SBA:
      return processSBA(data, offset, screen);
    case OrderCode.SF:
      return processSF(data, offset, screen);
    case OrderCode.SFE:
      return processSFE(data, offset, screen);
    case OrderCode.SA:
      return processSA(data, offset, screen);
    case OrderCode.MF:
      return processMF(data, offset, screen);
    case OrderCode.IC:
      return processIC(screen);
    case OrderCode.PT:
      return processPT(screen);
    case OrderCode.RA:
      return processRA(data, offset, screen);
    case OrderCode.EUA:
      return processEUA(data, offset, screen);
    case OrderCode.GE:
      return processGE(data, offset, screen);
    default:
      return 1; // skip unknown
  }
}

// ── Individual order processors ─────────────────────────────────────

/** SBA: Set Buffer Address — 3 bytes total. */
function processSBA(data: Buffer, offset: number, screen: ScreenBuffer): number {
  if (offset + 2 >= data.length) return 1;
  const address = decodeAddress(data[offset + 1], data[offset + 2]);
  screen.cursor.setPosition(address);
  return 3;
}

/** SF: Start Field — 2 bytes total. */
function processSF(data: Buffer, offset: number, screen: ScreenBuffer): number {
  if (offset + 1 >= data.length) return 1;
  const attribute = data[offset + 1];
  screen.setFieldAttribute(screen.cursor.position, attribute);
  screen.cursor.advance();
  return 2;
}

/** SFE: Start Field Extended — variable length. */
function processSFE(data: Buffer, offset: number, screen: ScreenBuffer): number {
  if (offset + 1 >= data.length) return 1;
  const pairCount = data[offset + 1];
  const totalLen = 2 + pairCount * 2;
  if (offset + totalLen > data.length) return 1;

  let basicAttr = 0;
  let foreground: number = Color.DEFAULT;
  let background: number = Color.DEFAULT;
  let highlight: number = Highlight.DEFAULT;

  for (let i = 0; i < pairCount; i++) {
    const type = data[offset + 2 + i * 2];
    const value = data[offset + 3 + i * 2];

    if (type === 0xC0) {
      // Basic field attribute (type 0xC0)
      basicAttr = value;
    } else if (type === ExtendedAttrType.FOREGROUND_COLOR) {
      foreground = value;
    } else if (type === ExtendedAttrType.BACKGROUND_COLOR) {
      background = value;
    } else if (type === ExtendedAttrType.HIGHLIGHT) {
      highlight = value;
    }
  }

  screen.setFieldAttribute(screen.cursor.position, basicAttr);
  screen.setFieldExtended(screen.cursor.position, { foreground, background, highlight });
  screen.cursor.advance();
  return totalLen;
}

/** SA: Set Attribute — 3 bytes total. Sets extended attribute for subsequent chars. */
function processSA(data: Buffer, offset: number, screen: ScreenBuffer): number {
  if (offset + 2 >= data.length) return 1;
  const type = data[offset + 1];
  const value = data[offset + 2];

  const update: Record<string, number> = {};
  if (type === ExtendedAttrType.FOREGROUND_COLOR) {
    update.foreground = value;
  } else if (type === ExtendedAttrType.BACKGROUND_COLOR) {
    update.background = value;
  } else if (type === ExtendedAttrType.HIGHLIGHT) {
    update.highlight = value;
  }

  screen.setCellExtended(screen.cursor.position, update);
  return 3;
}

/** MF: Modify Field — variable length. */
function processMF(data: Buffer, offset: number, screen: ScreenBuffer): number {
  if (offset + 1 >= data.length) return 1;
  const pairCount = data[offset + 1];
  const totalLen = 2 + pairCount * 2;
  if (offset + totalLen > data.length) return 1;

  for (let i = 0; i < pairCount; i++) {
    const type = data[offset + 2 + i * 2];
    const value = data[offset + 3 + i * 2];

    if (type === 0xC0) {
      // Modify the basic field attribute at the current field
      const field = screen.getFieldAt(screen.cursor.position);
      if (field) {
        screen.setFieldAttribute(field.start, value);
      }
    } else if (type === ExtendedAttrType.FOREGROUND_COLOR ||
               type === ExtendedAttrType.BACKGROUND_COLOR ||
               type === ExtendedAttrType.HIGHLIGHT) {
      const update: Record<string, number> = {};
      if (type === ExtendedAttrType.FOREGROUND_COLOR) update.foreground = value;
      if (type === ExtendedAttrType.BACKGROUND_COLOR) update.background = value;
      if (type === ExtendedAttrType.HIGHLIGHT) update.highlight = value;

      const field = screen.getFieldAt(screen.cursor.position);
      if (field) {
        screen.setFieldExtended(field.start, update);
      }
    }
  }

  return totalLen;
}

/** IC: Insert Cursor — 1 byte. Marks the current position as the cursor location. */
function processIC(_screen: ScreenBuffer): number {
  // IC simply records where the cursor should be after the write completes.
  // The cursor is already at the right position from preceding SBA.
  return 1;
}

/** PT: Program Tab — 1 byte. Advance to next unprotected field. */
function processPT(screen: ScreenBuffer): number {
  const nextField = screen.findNextUnprotectedField(screen.cursor.position);
  if (nextField) {
    screen.cursor.setPosition((nextField.start + 1) % screen.size);
  }
  return 1;
}

/** RA: Repeat to Address — 4 bytes total. Fill from cursor to address with char. */
function processRA(data: Buffer, offset: number, screen: ScreenBuffer): number {
  if (offset + 3 >= data.length) return 1;
  const endAddress = decodeAddress(data[offset + 1], data[offset + 2]);
  const fillChar = data[offset + 3];

  screen.fillRange(screen.cursor.position, endAddress, fillChar);
  screen.cursor.setPosition(endAddress);
  return 4;
}

/** EUA: Erase Unprotected to Address — 3 bytes total. */
function processEUA(data: Buffer, offset: number, screen: ScreenBuffer): number {
  if (offset + 2 >= data.length) return 1;
  const endAddress = decodeAddress(data[offset + 1], data[offset + 2]);

  screen.eraseUnprotectedRange(screen.cursor.position, endAddress);
  screen.cursor.setPosition(endAddress);
  return 3;
}

/** GE: Graphic Escape — 2 bytes total. Write a graphic (APL) character. */
function processGE(data: Buffer, offset: number, screen: ScreenBuffer): number {
  if (offset + 1 >= data.length) return 1;
  // GE is followed by a single EBCDIC graphic character
  screen.setChar(screen.cursor.position, data[offset + 1]);
  screen.cursor.advance();
  return 2;
}

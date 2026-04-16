/**
 * 3270 datastream parser.
 *
 * Processes Write commands from the host (W, EW, EWA) and builds Read
 * responses (RB, RM, RMA). Each record received from the Telnet layer
 * (between IAC EOR markers) is a single datastream message.
 *
 * Reference: IBM 3270 Data Stream Reference (GA23-0059)
 */

import { ScreenBuffer } from '../emulator/screen-buffer';
import { FieldAttr, type ExtendedAttributes, Color, Highlight } from '../emulator/field';
import { isOrder, processOrder, encodeAddress, OrderCode } from './orders';
import { ExtendedAttrType } from '../emulator/field';

// ── Command codes ───────────────────────────────────────────────────

/**
 * 3270 Write command codes (first byte of the record).
 *
 * Two encoding families exist: SNA (used in TN3270E) and non-SNA / CCW
 * (used in basic TN3270). We must handle both because the host's choice
 * depends on the negotiation outcome.
 */
export const WriteCommand = {
  // SNA command codes
  W:    0xF1,  // Write
  EW:   0xF5,  // Erase/Write
  EWA:  0x7E,  // Erase/Write Alternate
  RB:   0xF2,  // Read Buffer
  RM:   0xF6,  // Read Modified
  RMA:  0x6E,  // Read Modified All
  EAU:  0x6F,  // Erase All Unprotected
  WSF:  0xF3,  // Write Structured Field
  // Non-SNA (CCW) command codes
  CCW_W:    0x01,  // Write
  CCW_EW:   0x05,  // Erase/Write
  CCW_EWA:  0x0D,  // Erase/Write Alternate
  CCW_RB:   0x02,  // Read Buffer
  CCW_RM:   0x06,  // Read Modified
  CCW_RMA:  0x0E,  // Read Modified All
  CCW_EAU:  0x0F,  // Erase All Unprotected
  CCW_WSF:  0x11,  // Write Structured Field
} as const;

/** WCC (Write Control Character) bit flags. */
export const WCC = {
  RESET_MDT:     0x40,  // Reset all MDTs
  RESTORE_KB:    0x02,  // Restore keyboard (unlock)
  RESET_ALARM:   0x04,  // Reset alarm
  START_PRINTER: 0x08,  // Start printer (ignored)
  SOUND_ALARM:   0x04,  // Sound alarm
} as const;

/** AID (Attention IDentifier) codes. */
export const AID = {
  NONE:       0x60,
  ENTER:      0x7D,
  PF1:  0xF1, PF2:  0xF2, PF3:  0xF3, PF4:  0xF4,
  PF5:  0xF5, PF6:  0xF6, PF7:  0xF7, PF8:  0xF8,
  PF9:  0xF9, PF10: 0x7A, PF11: 0x7B, PF12: 0x7C,
  PF13: 0xC1, PF14: 0xC2, PF15: 0xC3, PF16: 0xC4,
  PF17: 0xC5, PF18: 0xC6, PF19: 0xC7, PF20: 0xC8,
  PF21: 0xC9, PF22: 0x4A, PF23: 0x4B, PF24: 0x4C,
  PA1:  0x6C, PA2:  0x6E, PA3:  0x6B,
  CLEAR: 0x6D,
  SYSREQ: 0xF0,
  ATTN: 0x00, // Special — sent as Telnet IAC IP
} as const;

// ── Result types ────────────────────────────────────────────────────

export enum DatastreamAction {
  ScreenUpdate,
  ReadBuffer,
  ReadModified,
  ReadModifiedAll,
  EraseAllUnprotected,
  Alarm,
  KeyboardUnlock,
  Unknown,
}

export interface DatastreamResult {
  actions: DatastreamAction[];
  wcc: number;
}

// ── Parser ──────────────────────────────────────────────────────────

/**
 * Process a complete 3270 datastream record.
 *
 * @param record Raw bytes between IAC EOR markers (already stripped)
 * @param screen The screen buffer to update
 * @returns What happened as a result of processing
 */
export function processRecord(record: Buffer, screen: ScreenBuffer): DatastreamResult {
  if (record.length === 0) {
    return { actions: [DatastreamAction.Unknown], wcc: 0 };
  }

  const command = record[0];
  const result: DatastreamResult = { actions: [], wcc: 0 };

  switch (command) {
    case WriteCommand.W:
    case WriteCommand.CCW_W:
      processWrite(record, screen, result);
      break;
    case WriteCommand.EW:
    case WriteCommand.CCW_EW:
      screen.eraseWrite();
      processWrite(record, screen, result);
      break;
    case WriteCommand.EWA:
    case WriteCommand.CCW_EWA:
      screen.eraseWriteAlternate();
      processWrite(record, screen, result);
      break;
    case WriteCommand.RB:
    case WriteCommand.CCW_RB:
      result.actions.push(DatastreamAction.ReadBuffer);
      break;
    case WriteCommand.RM:
    case WriteCommand.CCW_RM:
      result.actions.push(DatastreamAction.ReadModified);
      break;
    case WriteCommand.RMA:
    case WriteCommand.CCW_RMA:
      result.actions.push(DatastreamAction.ReadModifiedAll);
      break;
    case WriteCommand.EAU:
    case WriteCommand.CCW_EAU:
      screen.eraseAllUnprotected();
      result.actions.push(DatastreamAction.EraseAllUnprotected);
      break;
    default:
      result.actions.push(DatastreamAction.Unknown);
      break;
  }

  return result;
}

/**
 * Process a Write/EW/EWA command.
 * Byte 0 = command, Byte 1 = WCC, Bytes 2+ = orders and data.
 */
function processWrite(record: Buffer, screen: ScreenBuffer, result: DatastreamResult): void {
  if (record.length < 2) return;

  const wcc = record[1];
  result.wcc = wcc;
  result.actions.push(DatastreamAction.ScreenUpdate);

  // Handle WCC flags
  if (wcc & WCC.RESET_MDT) {
    resetAllMDT(screen);
  }
  if (wcc & WCC.RESTORE_KB) {
    result.actions.push(DatastreamAction.KeyboardUnlock);
  }
  if (wcc & WCC.SOUND_ALARM) {
    result.actions.push(DatastreamAction.Alarm);
  }

  // Current SA (Set Attribute) state — persists across characters until
  // reset by another SA, SF, or SFE order.
  const currentSA: ExtendedAttributes = {
    foreground: Color.DEFAULT,
    background: Color.DEFAULT,
    highlight: Highlight.DEFAULT,
  };

  // Process orders and data starting at byte 2
  let offset = 2;
  while (offset < record.length) {
    const byte = record[offset];

    if (isOrder(byte)) {
      // SA order: update the current SA state for subsequent characters
      if (byte === OrderCode.SA && offset + 2 < record.length) {
        const type = record[offset + 1];
        const value = record[offset + 2];
        if (type === ExtendedAttrType.FOREGROUND_COLOR) currentSA.foreground = value;
        else if (type === ExtendedAttrType.BACKGROUND_COLOR) currentSA.background = value;
        else if (type === ExtendedAttrType.HIGHLIGHT) currentSA.highlight = value;
      }
      // SF/SFE reset SA state — new field starts fresh
      if (byte === OrderCode.SF || byte === OrderCode.SFE) {
        currentSA.foreground = Color.DEFAULT;
        currentSA.background = Color.DEFAULT;
        currentSA.highlight = Highlight.DEFAULT;
      }

      const consumed = processOrder(record, offset, screen);
      offset += consumed;
    } else {
      // Regular character data — write at cursor position
      const pos = screen.cursor.position;
      screen.setChar(pos, byte);

      // Apply SA colors if active, otherwise inherit field colors
      if (currentSA.foreground !== Color.DEFAULT ||
          currentSA.background !== Color.DEFAULT ||
          currentSA.highlight !== Highlight.DEFAULT) {
        screen.setCellExtended(pos, currentSA);
      } else {
        screen.applyFieldColors(pos);
      }

      screen.cursor.advance();
      offset++;
    }
  }
}

/** Reset MDT on all fields. */
function resetAllMDT(screen: ScreenBuffer): void {
  for (const field of screen.fields) {
    if (field.attribute & FieldAttr.MDT) {
      const newAttr = field.attribute & ~FieldAttr.MDT;
      screen.setFieldAttribute(field.start, newAttr);
    }
  }
}

// ── Response builders ───────────────────────────────────────────────

/**
 * Build a Read Modified response.
 * Returns AID + cursor address + modified field data.
 */
export function buildReadModifiedResponse(
  screen: ScreenBuffer,
  aid: number,
): Buffer {
  const parts: number[] = [aid];

  // Cursor address
  const [cb1, cb2] = encodeAddress(screen.cursor.position);
  parts.push(cb1, cb2);

  // Short-read AIDs (PA keys, Clear) only send AID + cursor
  if (aid === AID.PA1 || aid === AID.PA2 || aid === AID.PA3 || aid === AID.CLEAR) {
    return Buffer.from(parts);
  }

  // For other AIDs, include modified field data
  const modified = screen.getModifiedFields();
  for (const field of modified) {

    // Skip leading nulls and trailing nulls
    let start = 0;
    while (start < field.data.length && field.data[start] === 0x00) {
      start++;
    }
    let end = field.data.length;
    while (end > start && field.data[end - 1] === 0x00) {
      end--;
    }

    // Only include field if there is non-null data
    if (start < end) {
      // SBA order + adjusted address (skip past leading nulls)
      parts.push(0x11); // SBA
      const dataAddr = (field.address + 1 + start) % screen.size;
      const [fb1, fb2] = encodeAddress(dataAddr);
      parts.push(fb1, fb2);

      for (let i = start; i < end; i++) {
        parts.push(field.data[i]);
      }
    }
  }

  return Buffer.from(parts);
}

/**
 * Build a Read Buffer response.
 * Returns AID + cursor address + full buffer contents.
 */
export function buildReadBufferResponse(
  screen: ScreenBuffer,
  aid: number,
): Buffer {
  const parts: number[] = [aid];

  // Cursor address
  const [cb1, cb2] = encodeAddress(screen.cursor.position);
  parts.push(cb1, cb2);

  // Dump entire buffer
  for (let pos = 0; pos < screen.size; pos++) {
    const cell = screen.getCell(pos);
    if (cell.fieldAttribute >= 0) {
      // Field attribute position: SF order + attribute byte
      parts.push(0x1D); // SF order code
      parts.push(cell.fieldAttribute);
    } else {
      parts.push(cell.char);
    }
  }

  return Buffer.from(parts);
}

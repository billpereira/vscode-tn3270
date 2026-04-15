/**
 * 3270 keyboard/input handler.
 *
 * Processes AID keys, field navigation, character input, and editing
 * actions against the ScreenBuffer. Manages keyboard lock/unlock state
 * and insert mode toggle.
 *
 * This module contains the core 3270 input logic — it knows nothing
 * about physical keys or the webview. The keyboard-mapper translates
 * physical key events into the typed messages consumed here.
 */

import { EventEmitter } from 'events';
import { ScreenBuffer } from './screen-buffer';
import {
  FieldAttr,
  isProtected,
  isNumeric,
  type Field,
} from './field';
import { AID, buildReadModifiedResponse } from '../protocol/datastream';
import { encodeChar } from '../protocol/ebcdic';

// ── Lock reasons ──────────────────────────────────────────────────

export const LockReason = {
  SYSTEM: 'X SYSTEM',
  WAIT: 'X WAIT',
  OPERATOR_ERROR: 'X',
  NOT_CONNECTED: 'X NOT CONNECTED',
} as const;

export type LockReasonType = typeof LockReason[keyof typeof LockReason];

// ── AID name → code mapping ───────────────────────────────────────

const AID_NAME_MAP: Record<string, number> = {
  Enter: AID.ENTER,
  PF1: AID.PF1, PF2: AID.PF2, PF3: AID.PF3, PF4: AID.PF4,
  PF5: AID.PF5, PF6: AID.PF6, PF7: AID.PF7, PF8: AID.PF8,
  PF9: AID.PF9, PF10: AID.PF10, PF11: AID.PF11, PF12: AID.PF12,
  PF13: AID.PF13, PF14: AID.PF14, PF15: AID.PF15, PF16: AID.PF16,
  PF17: AID.PF17, PF18: AID.PF18, PF19: AID.PF19, PF20: AID.PF20,
  PF21: AID.PF21, PF22: AID.PF22, PF23: AID.PF23, PF24: AID.PF24,
  PA1: AID.PA1, PA2: AID.PA2, PA3: AID.PA3,
  Clear: AID.CLEAR,
  SysReq: AID.SYSREQ,
  Attn: AID.ATTN,
};

// ── Events emitted by KeyboardHandler ────────────────────────────

export interface KeyboardHandlerEvents {
  /** A response buffer to send to the host (AID + data). */
  send: (data: Buffer) => void;
  /** Keyboard lock state changed. */
  lockChange: (locked: boolean, reason: string) => void;
  /** Insert mode toggled. */
  insertModeChange: (insertMode: boolean) => void;
  /** Sound the alarm (operator error). */
  alarm: () => void;
  /** Screen has been modified and should be re-rendered. */
  screenUpdate: () => void;
  /** Attn key — sent as Telnet IAC IP, not as data. */
  attn: () => void;
  /** SysReq key — sent as Telnet IAC IP in TN3270E mode. */
  sysreq: () => void;
}

// ── KeyboardHandler ──────────────────────────────────────────────

export class KeyboardHandler extends EventEmitter {
  private _screen: ScreenBuffer;
  private _locked: boolean = false;
  private _lockReason: string = '';
  private _insertMode: boolean = false;

  constructor(screen: ScreenBuffer) {
    super();
    this._screen = screen;
  }

  // ── State accessors ──────────────────────────────────────────

  get locked(): boolean { return this._locked; }
  get lockReason(): string { return this._lockReason; }
  get insertMode(): boolean { return this._insertMode; }

  /** Attach to a (possibly new) screen buffer. */
  setScreen(screen: ScreenBuffer): void {
    this._screen = screen;
  }

  // ── Lock management ──────────────────────────────────────────

  lock(reason: string): void {
    this._locked = true;
    this._lockReason = reason;
    this.emit('lockChange', true, reason);
  }

  unlock(): void {
    this._locked = false;
    this._lockReason = '';
    this.emit('lockChange', false, '');
  }

  // ── AID key handling ─────────────────────────────────────────

  /** Process an AID key press by name ('Enter', 'PF1', 'Clear', etc.). */
  handleAID(aidName: string): void {
    if (this._locked) return;

    const aid = AID_NAME_MAP[aidName];
    if (aid === undefined) return;

    // Attn is special — sent out-of-band (Telnet IAC IP)
    if (aid === AID.ATTN) {
      this.emit('attn');
      return;
    }

    // SysReq is also out-of-band in TN3270E
    if (aid === AID.SYSREQ) {
      this.emit('sysreq');
      return;
    }

    // Clear key: clear screen and send short read
    if (aid === AID.CLEAR) {
      this._screen.clear();
      this.emit('screenUpdate');
    }

    // Lock the keyboard — host must unlock via WCC.RESTORE_KB
    this.lock(LockReason.SYSTEM);

    // Build and send the Read Modified response
    const response = buildReadModifiedResponse(this._screen, aid);
    this.emit('send', response);
  }

  // ── Navigation ───────────────────────────────────────────────

  /** Process a navigation action. */
  handleNavigation(action: string): void {
    if (this._locked) return;

    const cursor = this._screen.cursor;

    switch (action) {
      case 'tab':
        this.tabForward();
        break;
      case 'backtab':
        this.tabBackward();
        break;
      case 'up':
        cursor.moveUp();
        break;
      case 'down':
        cursor.moveDown();
        break;
      case 'left':
        cursor.moveLeft();
        break;
      case 'right':
        cursor.moveRight();
        break;
      case 'home':
        this.moveHome();
        break;
      case 'end':
        this.moveEnd();
        break;
      case 'newline':
        this.tabForward();
        break;
      default:
        return;
    }

    this.emit('screenUpdate');
  }

  /** Tab: move to the first position of the next unprotected field. */
  private tabForward(): void {
    const field = this._screen.findNextUnprotectedField(this._screen.cursor.position);
    if (field) {
      this._screen.cursor.setPosition((field.start + 1) % this._screen.size);
    }
  }

  /** Backtab: move to the first position of the previous unprotected field. */
  private tabBackward(): void {
    const currentField = this._screen.getFieldAt(this._screen.cursor.position);
    const cursorPos = this._screen.cursor.position;

    // If cursor is NOT at start of current unprotected field, go to its start
    if (currentField && !isProtected(currentField.attribute)) {
      const fieldStart = (currentField.start + 1) % this._screen.size;
      if (cursorPos !== fieldStart) {
        this._screen.cursor.setPosition(fieldStart);
        return;
      }
    }

    // Cursor is at field start (or in a protected field) — find previous unprotected field.
    // Search from the field's attribute position (not cursor) to skip the current field.
    const searchFrom = currentField ? currentField.start : cursorPos;
    const field = this._screen.findPrevUnprotectedField(searchFrom);
    if (field && field !== currentField) {
      this._screen.cursor.setPosition((field.start + 1) % this._screen.size);
    } else if (field) {
      // Only one unprotected field — stay at its start
      this._screen.cursor.setPosition((field.start + 1) % this._screen.size);
    }
  }

  /** Home: move to the first unprotected field on the screen. */
  private moveHome(): void {
    const field = this._screen.findNextUnprotectedField(0);
    if (field) {
      this._screen.cursor.setPosition((field.start + 1) % this._screen.size);
    } else {
      this._screen.cursor.setPosition(0);
    }
  }

  /** End: move to the last non-blank position in the current field + 1. */
  private moveEnd(): void {
    const field = this._screen.getFieldAt(this._screen.cursor.position);
    if (!field || isProtected(field.attribute)) return;

    // Find the last non-null character in this field
    const data = this._screen.getFieldData(field);
    let lastNonBlank = -1;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i] !== 0x00) {
        lastNonBlank = i;
        break;
      }
    }

    // Position cursor after the last non-blank char
    const fieldDataStart = (field.start + 1) % this._screen.size;
    const newPos = (fieldDataStart + lastNonBlank + 1) % this._screen.size;
    this._screen.cursor.setPosition(newPos);
  }

  // ── Character input ──────────────────────────────────────────

  /** Process a single character input. */
  handleCharInput(char: string): void {
    if (this._locked) return;

    const field = this._screen.getFieldAt(this._screen.cursor.position);

    // No field or protected field → operator error
    if (!field || isProtected(field.attribute)) {
      this.operatorError();
      return;
    }

    // Check if cursor is on a field attribute byte (shouldn't type here)
    const cell = this._screen.getCell(this._screen.cursor.position);
    if (cell.fieldAttribute >= 0) {
      this.operatorError();
      return;
    }

    // Numeric field validation
    if (isNumeric(field.attribute)) {
      if (!isNumericChar(char)) {
        this.operatorError();
        return;
      }
    }

    const ebcdicChar = encodeChar(char);

    if (this._insertMode) {
      // Insert mode: shift characters right
      if (!this.insertChar(field, ebcdicChar)) {
        this.operatorError();
        return;
      }
    } else {
      // Overtype mode: write at cursor position
      this._screen.setChar(this._screen.cursor.position, ebcdicChar);
      this._screen.cursor.advance();
    }

    // Set MDT on the field
    this.setMDT(field);

    // Skip over any field attribute bytes
    this.skipFieldAttributes();

    this.emit('screenUpdate');
  }

  /** Insert a character at cursor, shifting field data right. Returns false on overflow. */
  private insertChar(field: Field, ebcdicChar: number): boolean {
    const data = this._screen.getFieldData(field);
    const fieldDataStart = (field.start + 1) % this._screen.size;
    const cursorOffset = (this._screen.cursor.position - fieldDataStart + this._screen.size) % this._screen.size;

    // Check if last position is non-null (field overflow)
    if (data.length > 0 && data[data.length - 1] !== 0x00) {
      return false;
    }

    // Shift characters right from cursor position
    for (let i = data.length - 1; i > cursorOffset; i--) {
      data[i] = data[i - 1];
    }
    data[cursorOffset] = ebcdicChar;

    // Write back to screen buffer
    for (let i = 0; i < data.length; i++) {
      this._screen.setChar((fieldDataStart + i) % this._screen.size, data[i]);
    }

    this._screen.cursor.advance();
    return true;
  }

  // ── Edit actions ─────────────────────────────────────────────

  /** Process an edit action. */
  handleEditAction(action: string): void {
    if (this._locked && action !== 'insertToggle') return;

    switch (action) {
      case 'delete':
        this.deleteChar();
        break;
      case 'backspace':
        this.backspace();
        break;
      case 'eraseEOF':
        this.eraseEOF();
        break;
      case 'eraseInput':
        this.eraseInput();
        break;
      case 'insertToggle':
        this.toggleInsert();
        break;
    }
  }

  /** Delete character at cursor, shift remaining field data left. */
  private deleteChar(): void {
    const field = this._screen.getFieldAt(this._screen.cursor.position);
    if (!field || isProtected(field.attribute)) {
      this.operatorError();
      return;
    }

    const cell = this._screen.getCell(this._screen.cursor.position);
    if (cell.fieldAttribute >= 0) {
      this.operatorError();
      return;
    }

    const data = this._screen.getFieldData(field);
    const fieldDataStart = (field.start + 1) % this._screen.size;
    const cursorOffset = (this._screen.cursor.position - fieldDataStart + this._screen.size) % this._screen.size;

    // Shift characters left
    for (let i = cursorOffset; i < data.length - 1; i++) {
      data[i] = data[i + 1];
    }
    data[data.length - 1] = 0x00;

    // Write back
    for (let i = 0; i < data.length; i++) {
      this._screen.setChar((fieldDataStart + i) % this._screen.size, data[i]);
    }

    this.setMDT(field);
    this.emit('screenUpdate');
  }

  /** Backspace: move cursor left then delete. */
  private backspace(): void {
    const field = this._screen.getFieldAt(this._screen.cursor.position);
    if (!field || isProtected(field.attribute)) {
      this.operatorError();
      return;
    }

    const fieldDataStart = (field.start + 1) % this._screen.size;

    // Don't backspace past the start of the field
    if (this._screen.cursor.position === fieldDataStart) {
      return;
    }

    this._screen.cursor.retreat();
    this.deleteChar();
  }

  /** Erase to end of field: null from cursor to end of current field. */
  private eraseEOF(): void {
    const field = this._screen.getFieldAt(this._screen.cursor.position);
    if (!field || isProtected(field.attribute)) {
      this.operatorError();
      return;
    }

    const cell = this._screen.getCell(this._screen.cursor.position);
    if (cell.fieldAttribute >= 0) {
      this.operatorError();
      return;
    }

    const data = this._screen.getFieldData(field);
    const fieldDataStart = (field.start + 1) % this._screen.size;
    const cursorOffset = (this._screen.cursor.position - fieldDataStart + this._screen.size) % this._screen.size;

    // Null from cursor position to end of field
    for (let i = cursorOffset; i < data.length; i++) {
      this._screen.setChar((fieldDataStart + i) % this._screen.size, 0x00);
    }

    this.setMDT(field);
    this.emit('screenUpdate');
  }

  /** Erase Input: clear all unprotected fields, home cursor. */
  private eraseInput(): void {
    this._screen.eraseAllUnprotected();
    this.emit('screenUpdate');
  }

  /** Toggle insert mode. */
  private toggleInsert(): void {
    this._insertMode = !this._insertMode;
    this.emit('insertModeChange', this._insertMode);
  }

  // ── Helpers ──────────────────────────────────────────────────

  /** Set the Modified Data Tag on a field. */
  private setMDT(field: Field): void {
    if (!(field.attribute & FieldAttr.MDT)) {
      field.attribute = field.attribute | FieldAttr.MDT;
      // Also update the cell's field attribute byte in the buffer
      const cell = this._screen.getCell(field.start);
      if (cell.fieldAttribute >= 0) {
        cell.fieldAttribute = field.attribute;
      }
    }
  }

  /** Skip over field attribute bytes after cursor movement. */
  private skipFieldAttributes(): void {
    const cell = this._screen.getCell(this._screen.cursor.position);
    if (cell.fieldAttribute >= 0) {
      // Landed on a field attribute byte — skip to next position
      this._screen.cursor.advance();
      // If next is also a field attribute, skip again (adjacent fields)
      const next = this._screen.getCell(this._screen.cursor.position);
      if (next.fieldAttribute >= 0) {
        this._screen.cursor.advance();
      }
    }
  }

  /** Signal an operator error (keyboard lock + alarm). */
  private operatorError(): void {
    this.lock(LockReason.OPERATOR_ERROR);
    this.emit('alarm');
  }

  /** Reset operator error (user presses Reset key). */
  handleReset(): void {
    if (this._locked && this._lockReason === LockReason.OPERATOR_ERROR) {
      this.unlock();
      this.emit('screenUpdate');
    }
  }
}

/** Check if a character is valid for a numeric field. */
function isNumericChar(char: string): boolean {
  return (char >= '0' && char <= '9') || char === '.' || char === '-' || char === '+';
}

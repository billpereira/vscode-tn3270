/**
 * Screen buffer model for the 3270 terminal emulator.
 *
 * Manages the character grid, attribute bytes, field list, and provides
 * methods for field navigation and buffer manipulation.
 */

import { Cursor } from './cursor';
import {
  type Field,
  type ExtendedAttributes,
  createField,
  defaultExtended,
  isProtected,
  FieldAttr,
} from './field';
import { type TerminalModel, DEFAULT_MODEL } from './terminal-model';

/** A single cell in the screen buffer. */
export interface Cell {
  /** EBCDIC character value (0x00 = null). */
  char: number;
  /** If this position is a field attribute byte, the raw attribute. -1 if not. */
  fieldAttribute: number;
  /** Extended attributes applied to this position. */
  extended: ExtendedAttributes;
}

export class ScreenBuffer {
  /** Current terminal model. */
  private _model: TerminalModel;
  /** Whether we're using the alternate screen (set by EWA). */
  private _alternate: boolean = false;
  /** Active screen rows. */
  private _rows: number;
  /** Active screen columns. */
  private _cols: number;
  /** The character/attribute grid. */
  private _buffer: Cell[];
  /** Ordered list of fields on the screen. */
  private _fields: Field[] = [];
  /** Cursor state. */
  readonly cursor: Cursor;

  constructor(model: TerminalModel = DEFAULT_MODEL) {
    this._model = model;
    this._rows = model.rows;
    this._cols = model.cols;
    this._buffer = this.createEmptyBuffer();
    this.cursor = new Cursor(this._rows, this._cols);
  }

  // ── Accessors ────────────────────────────────────────────────────

  get rows(): number { return this._rows; }
  get cols(): number { return this._cols; }
  get size(): number { return this._rows * this._cols; }
  get model(): TerminalModel { return this._model; }
  get fields(): readonly Field[] { return this._fields; }
  get isAlternate(): boolean { return this._alternate; }

  // ── Buffer operations ────────────────────────────────────────────

  /** Get the cell at a buffer address. */
  getCell(address: number): Cell {
    return this._buffer[this.wrap(address)];
  }

  /** Set the character at a buffer address. */
  setChar(address: number, char: number): void {
    this._buffer[this.wrap(address)].char = char;
  }

  /** Get the character at a buffer address. */
  getChar(address: number): number {
    return this._buffer[this.wrap(address)].char;
  }

  /** Set a field attribute at a buffer address. Creates or updates the field list. */
  setFieldAttribute(address: number, attribute: number): void {
    const pos = this.wrap(address);
    this._buffer[pos].fieldAttribute = attribute;
    this._buffer[pos].char = 0x00; // attribute bytes display as blank

    // Insert field in sorted order
    const field = createField(pos, attribute);
    const idx = this._fields.findIndex(f => f.start >= pos);
    if (idx === -1) {
      this._fields.push(field);
    } else if (this._fields[idx].start === pos) {
      this._fields[idx] = field; // update existing
    } else {
      this._fields.splice(idx, 0, field);
    }
  }

  /** Update extended attributes on a field at the given position. */
  setFieldExtended(address: number, extended: Partial<ExtendedAttributes>): void {
    const pos = this.wrap(address);
    const field = this._fields.find(f => f.start === pos);
    if (field) {
      Object.assign(field.extended, extended);
    }
    // Also set on the cell
    Object.assign(this._buffer[pos].extended, extended);
  }

  /** Set extended attributes on a specific cell (SA order). */
  setCellExtended(address: number, extended: Partial<ExtendedAttributes>): void {
    Object.assign(this._buffer[this.wrap(address)].extended, extended);
  }

  // ── Field queries ────────────────────────────────────────────────

  /** Find the field that contains the given buffer address. */
  getFieldAt(address: number): Field | undefined {
    const pos = this.wrap(address);
    if (this._fields.length === 0) return undefined;

    // Find the field whose attribute byte is at or before this position
    for (let i = this._fields.length - 1; i >= 0; i--) {
      if (this._fields[i].start <= pos) {
        return this._fields[i];
      }
    }
    // Wrap: position is before the first field → belongs to the last field
    return this._fields[this._fields.length - 1];
  }

  /** Find the next unprotected field after the given address. */
  findNextUnprotectedField(address: number): Field | undefined {
    if (this._fields.length === 0) return undefined;

    const pos = this.wrap(address);

    // Search forward from current position
    for (const field of this._fields) {
      if (field.start > pos && !isProtected(field.attribute)) {
        return field;
      }
    }
    // Wrap around from the beginning
    for (const field of this._fields) {
      if (!isProtected(field.attribute)) {
        return field;
      }
    }
    return undefined;
  }

  /** Find the previous unprotected field before the given address. */
  findPrevUnprotectedField(address: number): Field | undefined {
    if (this._fields.length === 0) return undefined;

    const pos = this.wrap(address);

    // Search backward from current position
    for (let i = this._fields.length - 1; i >= 0; i--) {
      if (this._fields[i].start < pos && !isProtected(this._fields[i].attribute)) {
        return this._fields[i];
      }
    }
    // Wrap around from the end
    for (let i = this._fields.length - 1; i >= 0; i--) {
      if (!isProtected(this._fields[i].attribute)) {
        return this._fields[i];
      }
    }
    return undefined;
  }

  // ── Screen operations ────────────────────────────────────────────

  /** Clear the entire buffer (all characters and fields). */
  clear(): void {
    this._buffer = this.createEmptyBuffer();
    this._fields = [];
    this.cursor.setPosition(0);
  }

  /** Erase all unprotected fields (EAU command). */
  eraseAllUnprotected(): void {
    for (let pos = 0; pos < this.size; pos++) {
      const field = this.getFieldAt(pos);
      if (field && !isProtected(field.attribute) && this._buffer[pos].fieldAttribute === -1) {
        this._buffer[pos].char = 0x00;
      }
    }
    // Reset MDT on all unprotected fields
    for (const field of this._fields) {
      if (!isProtected(field.attribute)) {
        field.attribute = field.attribute & ~FieldAttr.MDT;
        this._buffer[field.start].fieldAttribute = field.attribute;
      }
    }
    // Position cursor at first unprotected field
    const first = this.findNextUnprotectedField(0);
    if (first) {
      this.cursor.setPosition(this.wrap(first.start + 1));
    } else {
      this.cursor.setPosition(0);
    }
  }

  /** Erase/Write: clear buffer and switch to primary screen. */
  eraseWrite(): void {
    if (this._alternate) {
      this._alternate = false;
      this._rows = this._model.rows;
      this._cols = this._model.cols;
      this.cursor.resize(this._rows, this._cols);
    }
    this.clear();
  }

  /** Erase/Write Alternate: clear buffer and switch to alternate screen. */
  eraseWriteAlternate(): void {
    if (!this._alternate) {
      this._alternate = true;
      this._rows = this._model.altRows;
      this._cols = this._model.altCols;
      this.cursor.resize(this._rows, this._cols);
    }
    this.clear();
  }

  /** Fill a range of positions with a character (for RA order). */
  fillRange(start: number, end: number, char: number): void {
    let pos = this.wrap(start);
    const endPos = this.wrap(end);
    while (pos !== endPos) {
      if (this._buffer[pos].fieldAttribute === -1) {
        this._buffer[pos].char = char;
      }
      pos = this.wrap(pos + 1);
    }
  }

  /** Erase unprotected positions from start to end (for EUA order). */
  eraseUnprotectedRange(start: number, end: number): void {
    let pos = this.wrap(start);
    const endPos = this.wrap(end);
    while (pos !== endPos) {
      const field = this.getFieldAt(pos);
      if (field && !isProtected(field.attribute) && this._buffer[pos].fieldAttribute === -1) {
        this._buffer[pos].char = 0x00;
      }
      pos = this.wrap(pos + 1);
    }
  }

  // ── Read operations (for building host response) ─────────────────

  /** Get all modified fields and their data for Read Modified response. */
  getModifiedFields(): { address: number; data: number[] }[] {
    const result: { address: number; data: number[] }[] = [];
    for (const field of this._fields) {
      if (!isProtected(field.attribute) && (field.attribute & FieldAttr.MDT)) {
        const data = this.getFieldData(field);
        result.push({ address: field.start, data });
      }
    }
    return result;
  }

  /** Read all characters in a field (from attribute+1 to next attribute). */
  getFieldData(field: Field): number[] {
    const data: number[] = [];
    let pos = this.wrap(field.start + 1);
    while (this._buffer[pos].fieldAttribute === -1) {
      data.push(this._buffer[pos].char);
      pos = this.wrap(pos + 1);
      if (pos === field.start) break; // wrapped all the way around
    }
    return data;
  }

  // ── Internal helpers ─────────────────────────────────────────────

  private wrap(address: number): number {
    const size = this.size;
    return ((address % size) + size) % size;
  }

  private createEmptyBuffer(): Cell[] {
    const size = this._rows * this._cols;
    const buffer: Cell[] = new Array(size);
    for (let i = 0; i < size; i++) {
      buffer[i] = {
        char: 0x00,
        fieldAttribute: -1,
        extended: defaultExtended(),
      };
    }
    return buffer;
  }
}

/**
 * Cursor management for the 3270 screen buffer.
 */

export class Cursor {
  private _position: number = 0;
  private _rows: number;
  private _cols: number;

  constructor(rows: number, cols: number) {
    this._rows = rows;
    this._cols = cols;
  }

  /** Current buffer address. */
  get position(): number {
    return this._position;
  }

  /** Current row (0-based). */
  get row(): number {
    return Math.floor(this._position / this._cols);
  }

  /** Current column (0-based). */
  get col(): number {
    return this._position % this._cols;
  }

  /** Total buffer size. */
  get bufferSize(): number {
    return this._rows * this._cols;
  }

  /** Set cursor to a specific buffer address (wraps around). */
  setPosition(address: number): void {
    const size = this.bufferSize;
    this._position = ((address % size) + size) % size;
  }

  /** Move cursor forward by `n` positions (wraps). */
  advance(n: number = 1): void {
    this.setPosition(this._position + n);
  }

  /** Move cursor backward by `n` positions (wraps). */
  retreat(n: number = 1): void {
    this.setPosition(this._position - n);
  }

  /** Move cursor to a specific row and column. */
  moveTo(row: number, col: number): void {
    this.setPosition(row * this._cols + col);
  }

  /** Move cursor up one row (wraps at top). */
  moveUp(): void {
    this.setPosition(this._position - this._cols);
  }

  /** Move cursor down one row (wraps at bottom). */
  moveDown(): void {
    this.setPosition(this._position + this._cols);
  }

  /** Move cursor left one column (wraps at start of row to end of previous row). */
  moveLeft(): void {
    this.retreat(1);
  }

  /** Move cursor right one column (wraps at end of row to start of next row). */
  moveRight(): void {
    this.advance(1);
  }

  /** Move cursor to the start of the current row. */
  moveToStartOfRow(): void {
    this.moveTo(this.row, 0);
  }

  /** Convert a buffer address to row,col tuple. */
  addressToRowCol(address: number): [number, number] {
    const size = this.bufferSize;
    const wrapped = ((address % size) + size) % size;
    return [Math.floor(wrapped / this._cols), wrapped % this._cols];
  }

  /** Convert row,col to buffer address. */
  rowColToAddress(row: number, col: number): number {
    return row * this._cols + col;
  }

  /** Update dimensions (e.g., on model switch or EWA). */
  resize(rows: number, cols: number): void {
    this._rows = rows;
    this._cols = cols;
    // Clamp position to new buffer size
    if (this._position >= rows * cols) {
      this._position = 0;
    }
  }
}

/**
 * Terminal model definitions.
 * Defines screen dimensions for each supported IBM 3270 terminal model.
 */

export interface TerminalModel {
  /** Model identifier string sent during Telnet negotiation. */
  readonly name: string;
  /** Number of rows in the primary (default) screen. */
  readonly rows: number;
  /** Number of columns in the primary (default) screen. */
  readonly cols: number;
  /** Number of rows in the alternate screen (used with EWA). */
  readonly altRows: number;
  /** Number of columns in the alternate screen (used with EWA). */
  readonly altCols: number;
  /** Whether this model supports extended attributes (color, highlighting). */
  readonly extended: boolean;
}

/** IBM 3278 Model 2: 24×80 base, same alternate */
export const MODEL_3278_2: TerminalModel = {
  name: 'IBM-3278-2',
  rows: 24, cols: 80,
  altRows: 24, altCols: 80,
  extended: false,
};

/** IBM 3278 Model 3: 24×80 base, 32×80 alternate */
export const MODEL_3278_3: TerminalModel = {
  name: 'IBM-3278-3',
  rows: 24, cols: 80,
  altRows: 32, altCols: 80,
  extended: false,
};

/** IBM 3278 Model 4: 24×80 base, 43×80 alternate */
export const MODEL_3278_4: TerminalModel = {
  name: 'IBM-3278-4',
  rows: 24, cols: 80,
  altRows: 43, altCols: 80,
  extended: false,
};

/** IBM 3278 Model 5: 24×80 base, 27×132 alternate */
export const MODEL_3278_5: TerminalModel = {
  name: 'IBM-3278-5',
  rows: 24, cols: 80,
  altRows: 27, altCols: 132,
  extended: false,
};

/** IBM 3279 Model 2-E: 24×80 base, same alternate, with extended attributes */
export const MODEL_3279_2_E: TerminalModel = {
  name: 'IBM-3279-2-E',
  rows: 24, cols: 80,
  altRows: 24, altCols: 80,
  extended: true,
};

/** IBM 3279 Model 3-E: 24×80 base, 32×80 alternate, extended */
export const MODEL_3279_3_E: TerminalModel = {
  name: 'IBM-3279-3-E',
  rows: 24, cols: 80,
  altRows: 32, altCols: 80,
  extended: true,
};

/** IBM 3279 Model 4-E: 24×80 base, 43×80 alternate, extended */
export const MODEL_3279_4_E: TerminalModel = {
  name: 'IBM-3279-4-E',
  rows: 24, cols: 80,
  altRows: 43, altCols: 80,
  extended: true,
};

/** IBM 3279 Model 5-E: 24×80 base, 27×132 alternate, extended */
export const MODEL_3279_5_E: TerminalModel = {
  name: 'IBM-3279-5-E',
  rows: 24, cols: 80,
  altRows: 27, altCols: 132,
  extended: true,
};

/** All supported terminal models indexed by name. */
export const TERMINAL_MODELS: ReadonlyMap<string, TerminalModel> = new Map([
  [MODEL_3278_2.name, MODEL_3278_2],
  [MODEL_3278_3.name, MODEL_3278_3],
  [MODEL_3278_4.name, MODEL_3278_4],
  [MODEL_3278_5.name, MODEL_3278_5],
  [MODEL_3279_2_E.name, MODEL_3279_2_E],
  [MODEL_3279_3_E.name, MODEL_3279_3_E],
  [MODEL_3279_4_E.name, MODEL_3279_4_E],
  [MODEL_3279_5_E.name, MODEL_3279_5_E],
]);

/** Default terminal model. */
export const DEFAULT_MODEL = MODEL_3279_2_E;

/**
 * Look up a terminal model by name. Returns the default if not found.
 */
export function getModel(name: string): TerminalModel {
  return TERMINAL_MODELS.get(name) ?? DEFAULT_MODEL;
}

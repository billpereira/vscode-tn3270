/**
 * 3270 field attribute model.
 *
 * A field starts with an attribute byte at a buffer position. The attribute
 * byte occupies a screen position but is not displayed (it appears as a blank).
 * All characters after the attribute byte until the next attribute byte belong
 * to this field.
 */

// ── Basic field attribute bits (from SF order) ───────────────────────

/** Bit masks for the 3270 field attribute byte. */
export const FieldAttr = {
  /** Bits 0-1: Field protection + numeric */
  PROTECTED:  0x20,
  NUMERIC:    0x10,
  /** Bits 2-3: Display/intensify */
  DISPLAY_MASK: 0x0C,
  DISPLAY_NOT_PEN: 0x00,  // display, not pen-detectable
  DISPLAY_PEN:     0x04,  // display, pen-detectable
  INTENSIFIED:     0x08,  // intensified, pen-detectable
  NON_DISPLAY:     0x0C,  // non-display (hidden, e.g. passwords)
  /** Bit 5: Modified Data Tag */
  MDT: 0x01,
} as const;

// ── Extended attribute types (from SFE / SA orders) ──────────────────

/** Extended attribute type codes. */
export const ExtendedAttrType = {
  HIGHLIGHT:        0x41,
  FOREGROUND_COLOR: 0x42,
  BACKGROUND_COLOR: 0x43,
  CHARSET:          0x43, // rarely used, same byte as bg color in different context
  FIELD_OUTLINING:  0x44,
  TRANSPARENCY:     0x46,
} as const;

/** 3270 highlight values. */
export const Highlight = {
  DEFAULT:   0x00,
  NORMAL:    0xF0,
  BLINK:     0xF1,
  REVERSE:   0xF2,
  UNDERSCORE: 0xF4,
  INTENSIFY: 0xF8,
} as const;

/** 3270 color values (extended attribute). */
export const Color = {
  DEFAULT:   0x00,
  BLUE:      0xF1,
  RED:       0xF2,
  PINK:      0xF3,
  GREEN:     0xF4,
  TURQUOISE: 0xF5,
  YELLOW:    0xF6,
  WHITE:     0xF7,
} as const;

// ── Field descriptor ─────────────────────────────────────────────────

/** Extended attributes for a field or character position. */
export interface ExtendedAttributes {
  foreground: number;
  background: number;
  highlight: number;
}

/** Represents a 3270 field on the screen. */
export interface Field {
  /** Buffer address of the attribute byte. */
  start: number;
  /** Raw attribute byte value. */
  attribute: number;
  /** Extended attributes (color, highlighting). */
  extended: ExtendedAttributes;
}

/** Create default extended attributes. */
export function defaultExtended(): ExtendedAttributes {
  return {
    foreground: Color.DEFAULT,
    background: Color.DEFAULT,
    highlight: Highlight.DEFAULT,
  };
}

/** Create a new field at the given position. */
export function createField(start: number, attribute: number): Field {
  return { start, attribute, extended: defaultExtended() };
}

// ── Attribute query helpers ──────────────────────────────────────────

export function isProtected(attr: number): boolean {
  return (attr & FieldAttr.PROTECTED) !== 0;
}

export function isNumeric(attr: number): boolean {
  return (attr & FieldAttr.NUMERIC) !== 0;
}

export function isModified(attr: number): boolean {
  return (attr & FieldAttr.MDT) !== 0;
}

export function isDisplay(attr: number): boolean {
  return (attr & FieldAttr.DISPLAY_MASK) !== FieldAttr.NON_DISPLAY;
}

export function isIntensified(attr: number): boolean {
  return (attr & FieldAttr.DISPLAY_MASK) === FieldAttr.INTENSIFIED;
}

export function isNonDisplay(attr: number): boolean {
  return (attr & FieldAttr.DISPLAY_MASK) === FieldAttr.NON_DISPLAY;
}

export function isPenDetectable(attr: number): boolean {
  const display = attr & FieldAttr.DISPLAY_MASK;
  return display === FieldAttr.DISPLAY_PEN || display === FieldAttr.INTENSIFIED;
}

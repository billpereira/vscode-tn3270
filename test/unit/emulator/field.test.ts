import {
  FieldAttr, isProtected, isNumeric, isModified, isDisplay,
  isIntensified, isNonDisplay, isPenDetectable,
  createField, defaultExtended, Color, Highlight,
} from '../../../src/emulator/field';

describe('field attribute queries', () => {
  it('should detect protected fields', () => {
    expect(isProtected(FieldAttr.PROTECTED)).toBe(true);
    expect(isProtected(0x00)).toBe(false);
  });

  it('should detect numeric fields', () => {
    expect(isNumeric(FieldAttr.NUMERIC)).toBe(true);
    expect(isNumeric(0x00)).toBe(false);
  });

  it('should detect modified fields', () => {
    expect(isModified(FieldAttr.MDT)).toBe(true);
    expect(isModified(0x00)).toBe(false);
  });

  it('should detect display vs non-display', () => {
    expect(isDisplay(FieldAttr.DISPLAY_NOT_PEN)).toBe(true);
    expect(isDisplay(FieldAttr.DISPLAY_PEN)).toBe(true);
    expect(isDisplay(FieldAttr.INTENSIFIED)).toBe(true);
    expect(isDisplay(FieldAttr.NON_DISPLAY)).toBe(false);
  });

  it('should detect intensified fields', () => {
    expect(isIntensified(FieldAttr.INTENSIFIED)).toBe(true);
    expect(isIntensified(FieldAttr.DISPLAY_PEN)).toBe(false);
  });

  it('should detect non-display fields', () => {
    expect(isNonDisplay(FieldAttr.NON_DISPLAY)).toBe(true);
    expect(isNonDisplay(0x00)).toBe(false);
  });

  it('should detect pen-detectable fields', () => {
    expect(isPenDetectable(FieldAttr.DISPLAY_PEN)).toBe(true);
    expect(isPenDetectable(FieldAttr.INTENSIFIED)).toBe(true);
    expect(isPenDetectable(FieldAttr.DISPLAY_NOT_PEN)).toBe(false);
    expect(isPenDetectable(FieldAttr.NON_DISPLAY)).toBe(false);
  });

  it('should combine attributes correctly', () => {
    const attr = FieldAttr.PROTECTED | FieldAttr.NUMERIC | FieldAttr.MDT;
    expect(isProtected(attr)).toBe(true);
    expect(isNumeric(attr)).toBe(true);
    expect(isModified(attr)).toBe(true);
  });
});

describe('createField', () => {
  it('should create a field with default extended attributes', () => {
    const field = createField(10, FieldAttr.PROTECTED);
    expect(field.start).toBe(10);
    expect(field.attribute).toBe(FieldAttr.PROTECTED);
    expect(field.extended.foreground).toBe(Color.DEFAULT);
    expect(field.extended.background).toBe(Color.DEFAULT);
    expect(field.extended.highlight).toBe(Highlight.DEFAULT);
  });
});

describe('defaultExtended', () => {
  it('should return default color and highlight values', () => {
    const ext = defaultExtended();
    expect(ext.foreground).toBe(Color.DEFAULT);
    expect(ext.background).toBe(Color.DEFAULT);
    expect(ext.highlight).toBe(Highlight.DEFAULT);
  });
});

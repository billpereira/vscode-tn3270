import { ScreenBuffer } from '../../../src/emulator/screen-buffer';
import { FieldAttr, Color } from '../../../src/emulator/field';
import { MODEL_3278_2, MODEL_3279_2_E, MODEL_3278_5 } from '../../../src/emulator/terminal-model';

describe('ScreenBuffer', () => {
  let screen: ScreenBuffer;

  beforeEach(() => {
    screen = new ScreenBuffer(MODEL_3279_2_E);
  });

  it('should initialize with correct dimensions', () => {
    expect(screen.rows).toBe(24);
    expect(screen.cols).toBe(80);
    expect(screen.size).toBe(1920);
  });

  it('should start with all null characters', () => {
    for (let i = 0; i < screen.size; i++) {
      expect(screen.getChar(i)).toBe(0x00);
    }
  });

  describe('setChar / getChar', () => {
    it('should set and get a character', () => {
      screen.setChar(100, 0xC8); // 'H' in EBCDIC
      expect(screen.getChar(100)).toBe(0xC8);
    });

    it('should wrap addresses', () => {
      screen.setChar(1920, 0xC8);
      expect(screen.getChar(0)).toBe(0xC8);
    });
  });

  describe('field management', () => {
    it('should set a field attribute', () => {
      screen.setFieldAttribute(10, 0x00); // unprotected
      expect(screen.fields.length).toBe(1);
      expect(screen.fields[0].start).toBe(10);
    });

    it('should maintain fields in sorted order', () => {
      screen.setFieldAttribute(100, 0x00);
      screen.setFieldAttribute(50, FieldAttr.PROTECTED);
      screen.setFieldAttribute(200, 0x00);
      expect(screen.fields.map(f => f.start)).toEqual([50, 100, 200]);
    });

    it('should update existing field at same position', () => {
      screen.setFieldAttribute(10, 0x00);
      screen.setFieldAttribute(10, FieldAttr.PROTECTED);
      expect(screen.fields.length).toBe(1);
      expect(screen.fields[0].attribute).toBe(FieldAttr.PROTECTED);
    });

    it('should clear the character at the attribute position', () => {
      screen.setChar(10, 0xC8);
      screen.setFieldAttribute(10, 0x00);
      expect(screen.getChar(10)).toBe(0x00);
    });
  });

  describe('getFieldAt', () => {
    beforeEach(() => {
      // Set up: protected field at 0, unprotected at 40, protected at 79
      screen.setFieldAttribute(0, FieldAttr.PROTECTED);
      screen.setFieldAttribute(40, 0x00);
      screen.setFieldAttribute(79, FieldAttr.PROTECTED);
    });

    it('should find the field containing a position', () => {
      const field = screen.getFieldAt(50);
      expect(field?.start).toBe(40);
    });

    it('should find the field at the attribute position itself', () => {
      const field = screen.getFieldAt(40);
      expect(field?.start).toBe(40);
    });

    it('should wrap to last field for positions before first field', () => {
      // With fields at 0, 40, 79 — there's a field at 0 so this returns it
      screen.clear();
      screen.setFieldAttribute(40, 0x00);
      screen.setFieldAttribute(79, FieldAttr.PROTECTED);
      const field = screen.getFieldAt(10); // before field at 40
      expect(field?.start).toBe(79); // wraps to last field
    });

    it('should return undefined when no fields exist', () => {
      screen.clear();
      expect(screen.getFieldAt(10)).toBeUndefined();
    });
  });

  describe('findNextUnprotectedField', () => {
    it('should find the next unprotected field', () => {
      screen.setFieldAttribute(0, FieldAttr.PROTECTED);
      screen.setFieldAttribute(40, 0x00); // unprotected
      screen.setFieldAttribute(79, FieldAttr.PROTECTED);
      const field = screen.findNextUnprotectedField(0);
      expect(field?.start).toBe(40);
    });

    it('should wrap around to find unprotected fields', () => {
      screen.setFieldAttribute(10, 0x00); // unprotected
      screen.setFieldAttribute(40, FieldAttr.PROTECTED);
      const field = screen.findNextUnprotectedField(20);
      expect(field?.start).toBe(10); // wraps
    });

    it('should return undefined when all fields are protected', () => {
      screen.setFieldAttribute(0, FieldAttr.PROTECTED);
      screen.setFieldAttribute(40, FieldAttr.PROTECTED);
      expect(screen.findNextUnprotectedField(0)).toBeUndefined();
    });
  });

  describe('findPrevUnprotectedField', () => {
    it('should find the previous unprotected field', () => {
      screen.setFieldAttribute(10, 0x00); // unprotected
      screen.setFieldAttribute(40, FieldAttr.PROTECTED);
      const field = screen.findPrevUnprotectedField(40);
      expect(field?.start).toBe(10);
    });

    it('should wrap around backward', () => {
      screen.setFieldAttribute(100, 0x00); // unprotected
      screen.setFieldAttribute(10, FieldAttr.PROTECTED);
      const field = screen.findPrevUnprotectedField(5);
      expect(field?.start).toBe(100); // wraps
    });
  });

  describe('clear', () => {
    it('should reset all characters and fields', () => {
      screen.setChar(100, 0xC8);
      screen.setFieldAttribute(10, 0x00);
      screen.clear();
      expect(screen.getChar(100)).toBe(0x00);
      expect(screen.fields.length).toBe(0);
      expect(screen.cursor.position).toBe(0);
    });
  });

  describe('eraseAllUnprotected', () => {
    it('should clear unprotected field data and reset MDT', () => {
      screen.setFieldAttribute(0, FieldAttr.PROTECTED);
      screen.setFieldAttribute(10, FieldAttr.MDT); // unprotected + modified
      screen.setChar(11, 0xC8);
      screen.setChar(12, 0xC5);

      screen.eraseAllUnprotected();

      expect(screen.getChar(11)).toBe(0x00);
      expect(screen.getChar(12)).toBe(0x00);
      // MDT should be cleared
      expect(screen.fields[1].attribute & FieldAttr.MDT).toBe(0);
    });

    it('should not clear protected field data', () => {
      screen.setFieldAttribute(0, FieldAttr.PROTECTED);
      screen.setChar(1, 0xC8);
      screen.setFieldAttribute(10, 0x00);

      screen.eraseAllUnprotected();

      expect(screen.getChar(1)).toBe(0xC8); // preserved
    });
  });

  describe('eraseWrite / eraseWriteAlternate', () => {
    it('should reset to primary screen', () => {
      const s = new ScreenBuffer(MODEL_3278_5);
      s.eraseWriteAlternate();
      expect(s.rows).toBe(27);
      expect(s.cols).toBe(132);
      expect(s.isAlternate).toBe(true);

      s.eraseWrite();
      expect(s.rows).toBe(24);
      expect(s.cols).toBe(80);
      expect(s.isAlternate).toBe(false);
    });

    it('should switch to alternate screen dimensions', () => {
      const s = new ScreenBuffer(MODEL_3278_5);
      s.eraseWriteAlternate();
      expect(s.rows).toBe(27);
      expect(s.cols).toBe(132);
      expect(s.size).toBe(3564);
    });
  });

  describe('fillRange', () => {
    it('should fill a range with a character', () => {
      screen.fillRange(10, 15, 0x40); // fill with spaces
      for (let i = 10; i < 15; i++) {
        expect(screen.getChar(i)).toBe(0x40);
      }
      expect(screen.getChar(15)).toBe(0x00); // end position not filled
    });

    it('should not overwrite field attribute positions', () => {
      screen.setFieldAttribute(12, 0x00);
      screen.fillRange(10, 15, 0x40);
      expect(screen.getChar(12)).toBe(0x00); // attribute byte preserved
    });

    it('should wrap around the buffer', () => {
      screen.fillRange(1918, 2, 0xC8);
      expect(screen.getChar(1918)).toBe(0xC8);
      expect(screen.getChar(1919)).toBe(0xC8);
      expect(screen.getChar(0)).toBe(0xC8);
      expect(screen.getChar(1)).toBe(0xC8);
    });
  });

  describe('eraseUnprotectedRange', () => {
    it('should erase unprotected cells in range', () => {
      screen.setFieldAttribute(5, 0x00); // unprotected
      screen.setChar(6, 0xC8);
      screen.setChar(7, 0xC5);
      screen.eraseUnprotectedRange(6, 8);
      expect(screen.getChar(6)).toBe(0x00);
      expect(screen.getChar(7)).toBe(0x00);
    });

    it('should not erase protected cells', () => {
      screen.setFieldAttribute(5, FieldAttr.PROTECTED);
      screen.setChar(6, 0xC8);
      screen.eraseUnprotectedRange(6, 8);
      expect(screen.getChar(6)).toBe(0xC8); // preserved
    });
  });

  describe('getModifiedFields', () => {
    it('should return fields with MDT set', () => {
      screen.setFieldAttribute(0, FieldAttr.PROTECTED);
      screen.setFieldAttribute(10, FieldAttr.MDT); // unprotected + modified
      screen.setChar(11, 0xC8);
      screen.setChar(12, 0xC5);
      screen.setFieldAttribute(20, 0x00); // unprotected, not modified

      const modified = screen.getModifiedFields();
      expect(modified.length).toBe(1);
      expect(modified[0].address).toBe(10);
      expect(modified[0].data[0]).toBe(0xC8);
      expect(modified[0].data[1]).toBe(0xC5);
    });

    it('should return empty array when no fields are modified', () => {
      screen.setFieldAttribute(0, 0x00);
      expect(screen.getModifiedFields().length).toBe(0);
    });
  });

  describe('setFieldExtended / setCellExtended', () => {
    it('should set extended attributes on a field', () => {
      screen.setFieldAttribute(10, 0x00);
      screen.setFieldExtended(10, { foreground: Color.GREEN });
      expect(screen.fields[0].extended.foreground).toBe(Color.GREEN);
    });

    it('should set extended attributes on a cell', () => {
      screen.setCellExtended(50, { foreground: Color.RED });
      expect(screen.getCell(50).extended.foreground).toBe(Color.RED);
    });
  });
});

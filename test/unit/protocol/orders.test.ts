import {
  OrderCode, decodeAddress, encodeAddress, isOrder, processOrder,
} from '../../../src/protocol/orders';
import { ScreenBuffer } from '../../../src/emulator/screen-buffer';
import { FieldAttr, Color, Highlight, ExtendedAttrType } from '../../../src/emulator/field';
import { MODEL_3279_2_E } from '../../../src/emulator/terminal-model';

describe('decodeAddress', () => {
  it('should decode 14-bit address', () => {
    // Address 160 = row 2, col 0 on 80-col screen
    // 14-bit: 0x00, 0xA0
    expect(decodeAddress(0x00, 0xA0)).toBe(160);
  });

  it('should decode 12-bit address', () => {
    // 12-bit encoding: high 2 bits of first byte are non-zero
    // Address 0: both bytes map to 0
    expect(decodeAddress(0x40, 0x40)).toBe(0);
  });

  it('should decode address 0', () => {
    expect(decodeAddress(0x00, 0x00)).toBe(0);
  });

  it('should decode high addresses', () => {
    // Address 1919 (last position on 24x80)
    // 14-bit: (0x07 << 8) | 0x7F = 1919
    expect(decodeAddress(0x07, 0x7F)).toBe(1919);
  });
});

describe('encodeAddress', () => {
  it('should encode address 0', () => {
    expect(encodeAddress(0)).toEqual([0x00, 0x00]);
  });

  it('should encode address 160', () => {
    expect(encodeAddress(160)).toEqual([0x00, 0xA0]);
  });

  it('should round-trip with decodeAddress', () => {
    for (const addr of [0, 1, 79, 80, 160, 1919]) {
      const [b1, b2] = encodeAddress(addr);
      expect(decodeAddress(b1, b2)).toBe(addr);
    }
  });
});

describe('isOrder', () => {
  it('should recognize all order codes', () => {
    expect(isOrder(OrderCode.SBA)).toBe(true);
    expect(isOrder(OrderCode.SF)).toBe(true);
    expect(isOrder(OrderCode.SFE)).toBe(true);
    expect(isOrder(OrderCode.SA)).toBe(true);
    expect(isOrder(OrderCode.MF)).toBe(true);
    expect(isOrder(OrderCode.IC)).toBe(true);
    expect(isOrder(OrderCode.PT)).toBe(true);
    expect(isOrder(OrderCode.RA)).toBe(true);
    expect(isOrder(OrderCode.EUA)).toBe(true);
    expect(isOrder(OrderCode.GE)).toBe(true);
  });

  it('should reject non-order bytes', () => {
    expect(isOrder(0x00)).toBe(false);
    expect(isOrder(0xC8)).toBe(false);
    expect(isOrder(0xFF)).toBe(false);
  });
});

describe('processOrder', () => {
  let screen: ScreenBuffer;

  beforeEach(() => {
    screen = new ScreenBuffer(MODEL_3279_2_E);
  });

  describe('SBA (Set Buffer Address)', () => {
    it('should set cursor to the specified address', () => {
      const data = Buffer.from([OrderCode.SBA, 0x00, 0xA0]); // address 160
      const consumed = processOrder(data, 0, screen);
      expect(consumed).toBe(3);
      expect(screen.cursor.position).toBe(160);
    });

    it('should handle address at row 5, col 10', () => {
      const addr = 5 * 80 + 10; // 410
      const [b1, b2] = encodeAddress(addr);
      const data = Buffer.from([OrderCode.SBA, b1, b2]);
      processOrder(data, 0, screen);
      expect(screen.cursor.position).toBe(410);
    });
  });

  describe('SF (Start Field)', () => {
    it('should create a field at cursor position', () => {
      screen.cursor.setPosition(100);
      const data = Buffer.from([OrderCode.SF, FieldAttr.PROTECTED]);
      const consumed = processOrder(data, 0, screen);
      expect(consumed).toBe(2);
      expect(screen.fields.length).toBe(1);
      expect(screen.fields[0].start).toBe(100);
      expect(screen.fields[0].attribute).toBe(FieldAttr.PROTECTED);
      expect(screen.cursor.position).toBe(101); // cursor advances
    });

    it('should create an unprotected field', () => {
      screen.cursor.setPosition(50);
      const data = Buffer.from([OrderCode.SF, 0x00]);
      processOrder(data, 0, screen);
      expect(screen.fields[0].attribute).toBe(0x00);
    });
  });

  describe('SFE (Start Field Extended)', () => {
    it('should create a field with extended attributes', () => {
      screen.cursor.setPosition(200);
      const data = Buffer.from([
        OrderCode.SFE,
        0x03, // 3 attribute pairs
        0xC0, FieldAttr.PROTECTED,                   // basic attribute
        ExtendedAttrType.FOREGROUND_COLOR, Color.RED, // foreground
        ExtendedAttrType.HIGHLIGHT, Highlight.UNDERSCORE, // highlight
      ]);
      const consumed = processOrder(data, 0, screen);
      expect(consumed).toBe(8); // 2 + 3*2
      expect(screen.fields[0].start).toBe(200);
      expect(screen.fields[0].attribute).toBe(FieldAttr.PROTECTED);
      expect(screen.fields[0].extended.foreground).toBe(Color.RED);
      expect(screen.fields[0].extended.highlight).toBe(Highlight.UNDERSCORE);
      expect(screen.cursor.position).toBe(201);
    });
  });

  describe('SA (Set Attribute)', () => {
    it('should set extended attribute on current cell', () => {
      screen.cursor.setPosition(50);
      const data = Buffer.from([
        OrderCode.SA, ExtendedAttrType.FOREGROUND_COLOR, Color.GREEN,
      ]);
      const consumed = processOrder(data, 0, screen);
      expect(consumed).toBe(3);
      expect(screen.getCell(50).extended.foreground).toBe(Color.GREEN);
    });
  });

  describe('MF (Modify Field)', () => {
    it('should modify an existing field', () => {
      screen.setFieldAttribute(100, 0x00);
      screen.cursor.setPosition(105); // inside the field

      const data = Buffer.from([
        OrderCode.MF,
        0x01, // 1 pair
        ExtendedAttrType.FOREGROUND_COLOR, Color.BLUE,
      ]);
      const consumed = processOrder(data, 0, screen);
      expect(consumed).toBe(4);
      expect(screen.fields[0].extended.foreground).toBe(Color.BLUE);
    });
  });

  describe('IC (Insert Cursor)', () => {
    it('should consume 1 byte', () => {
      screen.cursor.setPosition(300);
      const data = Buffer.from([OrderCode.IC]);
      const consumed = processOrder(data, 0, screen);
      expect(consumed).toBe(1);
      expect(screen.cursor.position).toBe(300); // position unchanged
    });
  });

  describe('PT (Program Tab)', () => {
    it('should advance to next unprotected field', () => {
      screen.setFieldAttribute(0, FieldAttr.PROTECTED);
      screen.setFieldAttribute(40, 0x00); // unprotected
      screen.cursor.setPosition(10);

      const data = Buffer.from([OrderCode.PT]);
      const consumed = processOrder(data, 0, screen);
      expect(consumed).toBe(1);
      expect(screen.cursor.position).toBe(41); // first data position after attribute
    });
  });

  describe('RA (Repeat to Address)', () => {
    it('should fill range with character', () => {
      screen.cursor.setPosition(10);
      const [b1, b2] = encodeAddress(15);
      const data = Buffer.from([OrderCode.RA, b1, b2, 0x40]); // fill with spaces
      const consumed = processOrder(data, 0, screen);
      expect(consumed).toBe(4);

      for (let i = 10; i < 15; i++) {
        expect(screen.getChar(i)).toBe(0x40);
      }
      expect(screen.cursor.position).toBe(15);
    });

    it('should fill with null characters (clear)', () => {
      screen.cursor.setPosition(0);
      // Set some data first
      screen.setChar(0, 0xC8);
      screen.setChar(1, 0xC5);

      const [b1, b2] = encodeAddress(5);
      const data = Buffer.from([OrderCode.RA, b1, b2, 0x00]);
      processOrder(data, 0, screen);

      expect(screen.getChar(0)).toBe(0x00);
      expect(screen.getChar(1)).toBe(0x00);
    });
  });

  describe('EUA (Erase Unprotected to Address)', () => {
    it('should erase unprotected positions', () => {
      screen.setFieldAttribute(5, 0x00); // unprotected
      screen.setChar(6, 0xC8);
      screen.setChar(7, 0xC5);
      screen.cursor.setPosition(6);

      const [b1, b2] = encodeAddress(10);
      const data = Buffer.from([OrderCode.EUA, b1, b2]);
      const consumed = processOrder(data, 0, screen);
      expect(consumed).toBe(3);
      expect(screen.getChar(6)).toBe(0x00);
      expect(screen.getChar(7)).toBe(0x00);
      expect(screen.cursor.position).toBe(10);
    });

    it('should not erase protected positions', () => {
      screen.setFieldAttribute(5, FieldAttr.PROTECTED);
      screen.setChar(6, 0xC8);
      screen.cursor.setPosition(6);

      const [b1, b2] = encodeAddress(10);
      const data = Buffer.from([OrderCode.EUA, b1, b2]);
      processOrder(data, 0, screen);
      expect(screen.getChar(6)).toBe(0xC8); // preserved
    });
  });

  describe('GE (Graphic Escape)', () => {
    it('should write a graphic character and advance cursor', () => {
      screen.cursor.setPosition(50);
      const data = Buffer.from([OrderCode.GE, 0xAB]); // some graphic char
      const consumed = processOrder(data, 0, screen);
      expect(consumed).toBe(2);
      expect(screen.getChar(50)).toBe(0xAB);
      expect(screen.cursor.position).toBe(51);
    });
  });

  describe('order at offset', () => {
    it('should handle order at non-zero offset in buffer', () => {
      const data = Buffer.from([0xC8, 0xC5, OrderCode.SBA, 0x00, 0x50]);
      const consumed = processOrder(data, 2, screen);
      expect(consumed).toBe(3);
      expect(screen.cursor.position).toBe(80);
    });
  });

  describe('truncated data', () => {
    it('should handle truncated SBA gracefully', () => {
      const data = Buffer.from([OrderCode.SBA]);
      const consumed = processOrder(data, 0, screen);
      expect(consumed).toBe(1); // can't process, return 1
    });

    it('should handle truncated RA gracefully', () => {
      const data = Buffer.from([OrderCode.RA, 0x00]);
      const consumed = processOrder(data, 0, screen);
      expect(consumed).toBe(1);
    });
  });
});

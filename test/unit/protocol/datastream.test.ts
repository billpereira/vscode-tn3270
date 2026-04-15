import {
  processRecord, buildReadModifiedResponse, buildReadBufferResponse,
  WriteCommand, WCC, AID, DatastreamAction,
} from '../../../src/protocol/datastream';
import { ScreenBuffer } from '../../../src/emulator/screen-buffer';
import { FieldAttr } from '../../../src/emulator/field';
import { OrderCode, encodeAddress } from '../../../src/protocol/orders';
import { MODEL_3279_2_E, MODEL_3278_5 } from '../../../src/emulator/terminal-model';

describe('processRecord', () => {
  let screen: ScreenBuffer;

  beforeEach(() => {
    screen = new ScreenBuffer(MODEL_3279_2_E);
  });

  it('should return Unknown for empty records', () => {
    const result = processRecord(Buffer.from([]), screen);
    expect(result.actions).toContain(DatastreamAction.Unknown);
  });

  describe('Write (W)', () => {
    it('should process a simple Write with character data', () => {
      // W + WCC + SBA(0,0) + "HI" (EBCDIC)
      const [b1, b2] = encodeAddress(0);
      const record = Buffer.from([
        WriteCommand.W, 0x00, // command + WCC
        OrderCode.SBA, b1, b2, // SBA to position 0
        0xC8, 0xC9, // "HI" in EBCDIC
      ]);

      const result = processRecord(record, screen);
      expect(result.actions).toContain(DatastreamAction.ScreenUpdate);
      expect(screen.getChar(0)).toBe(0xC8); // H
      expect(screen.getChar(1)).toBe(0xC9); // I
    });

    it('should parse WCC with RESTORE_KB flag', () => {
      const record = Buffer.from([WriteCommand.W, WCC.RESTORE_KB]);
      const result = processRecord(record, screen);
      expect(result.actions).toContain(DatastreamAction.KeyboardUnlock);
    });

    it('should parse WCC with SOUND_ALARM flag', () => {
      const record = Buffer.from([WriteCommand.W, WCC.SOUND_ALARM]);
      const result = processRecord(record, screen);
      expect(result.actions).toContain(DatastreamAction.Alarm);
    });

    it('should reset MDT when WCC has RESET_MDT', () => {
      // Set up a field with MDT
      screen.setFieldAttribute(0, FieldAttr.MDT);
      expect(screen.fields[0].attribute & FieldAttr.MDT).toBeTruthy();

      const record = Buffer.from([WriteCommand.W, WCC.RESET_MDT]);
      processRecord(record, screen);

      expect(screen.fields[0].attribute & FieldAttr.MDT).toBe(0);
    });

    it('should create fields with SF orders', () => {
      const record = Buffer.from([
        WriteCommand.W, 0x00,
        OrderCode.SBA, 0x00, 0x00,     // SBA to position 0
        OrderCode.SF, FieldAttr.PROTECTED, // protected field
        0xC8, 0xC5, 0xD3, 0xD3, 0xD6,   // "HELLO"
        OrderCode.SBA, 0x00, 0x50,     // SBA to position 80
        OrderCode.SF, 0x00,            // unprotected field
      ]);

      processRecord(record, screen);

      expect(screen.fields.length).toBe(2);
      expect(screen.fields[0].start).toBe(0);
      expect(screen.fields[0].attribute).toBe(FieldAttr.PROTECTED);
      expect(screen.fields[1].start).toBe(80);
      expect(screen.getChar(1)).toBe(0xC8); // H at position 1 (after field attr)
    });

    it('should handle RA (Repeat to Address) in write', () => {
      const [b1, b2] = encodeAddress(80);
      const record = Buffer.from([
        WriteCommand.W, 0x00,
        OrderCode.SBA, 0x00, 0x00,
        OrderCode.RA, b1, b2, 0x40, // fill 0-79 with spaces
      ]);

      processRecord(record, screen);

      for (let i = 0; i < 80; i++) {
        expect(screen.getChar(i)).toBe(0x40); // space
      }
    });
  });

  describe('Erase/Write (EW)', () => {
    it('should clear screen before writing', () => {
      screen.setChar(500, 0xC8); // pre-existing data

      const record = Buffer.from([
        WriteCommand.EW, WCC.RESTORE_KB,
        OrderCode.SBA, 0x00, 0x00,
        0xC8,
      ]);

      processRecord(record, screen);

      expect(screen.getChar(0)).toBe(0xC8); // new data
      expect(screen.getChar(500)).toBe(0x00); // cleared
    });

    it('should use primary screen dimensions', () => {
      const s = new ScreenBuffer(MODEL_3278_5);
      s.eraseWriteAlternate(); // switch to alt (27x132)
      expect(s.rows).toBe(27);

      const record = Buffer.from([WriteCommand.EW, 0x00]);
      processRecord(record, s);
      expect(s.rows).toBe(24); // back to primary
      expect(s.cols).toBe(80);
    });
  });

  describe('Erase/Write Alternate (EWA)', () => {
    it('should switch to alternate screen', () => {
      const s = new ScreenBuffer(MODEL_3278_5);
      const record = Buffer.from([WriteCommand.EWA, 0x00]);
      processRecord(record, s);
      expect(s.rows).toBe(27);
      expect(s.cols).toBe(132);
      expect(s.isAlternate).toBe(true);
    });
  });

  describe('Read commands', () => {
    it('should return ReadBuffer action for RB', () => {
      const result = processRecord(Buffer.from([WriteCommand.RB]), screen);
      expect(result.actions).toContain(DatastreamAction.ReadBuffer);
    });

    it('should return ReadModified action for RM', () => {
      const result = processRecord(Buffer.from([WriteCommand.RM]), screen);
      expect(result.actions).toContain(DatastreamAction.ReadModified);
    });

    it('should return ReadModifiedAll action for RMA', () => {
      const result = processRecord(Buffer.from([WriteCommand.RMA]), screen);
      expect(result.actions).toContain(DatastreamAction.ReadModifiedAll);
    });
  });

  describe('Erase All Unprotected (EAU)', () => {
    it('should erase unprotected fields', () => {
      screen.setFieldAttribute(0, FieldAttr.PROTECTED);
      screen.setChar(1, 0xC8); // protected data
      screen.setFieldAttribute(10, 0x00); // unprotected
      screen.setChar(11, 0xC5); // unprotected data

      const result = processRecord(Buffer.from([WriteCommand.EAU]), screen);
      expect(result.actions).toContain(DatastreamAction.EraseAllUnprotected);
      expect(screen.getChar(1)).toBe(0xC8); // preserved
      expect(screen.getChar(11)).toBe(0x00); // cleared
    });
  });

  describe('complex screen', () => {
    it('should process a typical TSO login screen pattern', () => {
      // Simulated: EW + WCC + protected label + unprotected input field
      const [pos1b1, pos1b2] = encodeAddress(0);
      const [pos2b1, pos2b2] = encodeAddress(10);
      const [pos3b1, pos3b2] = encodeAddress(20);

      const record = Buffer.from([
        WriteCommand.EW, WCC.RESTORE_KB | WCC.RESET_MDT,
        // Position 0: protected label "USERID"
        OrderCode.SBA, pos1b1, pos1b2,
        OrderCode.SF, FieldAttr.PROTECTED,
        0xE4, 0xE2, 0xC5, 0xD9, 0xC9, 0xC4, // "USERID" in EBCDIC
        // Position 10: unprotected input field
        OrderCode.SBA, pos2b1, pos2b2,
        OrderCode.SF, 0x00,
        // Position 20: next protected field (ends input)
        OrderCode.SBA, pos3b1, pos3b2,
        OrderCode.SF, FieldAttr.PROTECTED,
        // IC at input field
        OrderCode.SBA, pos2b1 | 0x00, pos2b2 + 1, // position 11
        OrderCode.IC,
      ]);

      const result = processRecord(record, screen);
      expect(result.actions).toContain(DatastreamAction.ScreenUpdate);
      expect(result.actions).toContain(DatastreamAction.KeyboardUnlock);
      expect(screen.fields.length).toBe(3);

      // Check label data
      expect(screen.getChar(1)).toBe(0xE4); // 'U'
      expect(screen.getChar(2)).toBe(0xE2); // 'S'

      // Input field should be unprotected
      const inputField = screen.getFieldAt(11);
      expect(inputField).toBeDefined();
      expect(inputField!.attribute & FieldAttr.PROTECTED).toBe(0);
    });
  });
});

describe('buildReadModifiedResponse', () => {
  let screen: ScreenBuffer;

  beforeEach(() => {
    screen = new ScreenBuffer(MODEL_3279_2_E);
  });

  it('should build AID + cursor for PA keys (short read)', () => {
    screen.cursor.setPosition(100);
    const response = buildReadModifiedResponse(screen, AID.PA1);
    expect(response.length).toBe(3); // AID + 2-byte cursor address
    expect(response[0]).toBe(AID.PA1);
  });

  it('should build AID + cursor for Clear (short read)', () => {
    const response = buildReadModifiedResponse(screen, AID.CLEAR);
    expect(response.length).toBe(3);
    expect(response[0]).toBe(AID.CLEAR);
  });

  it('should include modified field data for Enter', () => {
    screen.setFieldAttribute(0, FieldAttr.PROTECTED);
    screen.setFieldAttribute(10, FieldAttr.MDT); // unprotected + modified
    screen.setChar(11, 0xC8); // H
    screen.setChar(12, 0xC5); // E

    const response = buildReadModifiedResponse(screen, AID.ENTER);
    expect(response[0]).toBe(AID.ENTER);
    // Should contain SBA order for the modified field data
    expect(response.includes(0x11)).toBe(true); // SBA order byte
  });

  it('should skip unmodified fields', () => {
    screen.setFieldAttribute(0, 0x00); // unprotected, NOT modified
    screen.setChar(1, 0xC8);

    const response = buildReadModifiedResponse(screen, AID.ENTER);
    // Only AID + cursor (3 bytes), no field data
    expect(response.length).toBe(3);
  });

  it('should strip trailing nulls from field data', () => {
    screen.setFieldAttribute(0, FieldAttr.MDT);
    screen.setChar(1, 0xC8);
    screen.setChar(2, 0x00); // trailing null
    screen.setFieldAttribute(5, FieldAttr.PROTECTED); // end of field

    const response = buildReadModifiedResponse(screen, AID.ENTER);
    // Field data should only contain 0xC8, not trailing 0x00
    const dataStart = response.indexOf(0x11) + 3; // after SBA + address
    expect(response[dataStart]).toBe(0xC8);
    // Next byte should be the next SBA or end of response
  });
});

describe('buildReadBufferResponse', () => {
  let screen: ScreenBuffer;

  beforeEach(() => {
    screen = new ScreenBuffer(MODEL_3279_2_E);
  });

  it('should include AID and cursor address', () => {
    screen.cursor.setPosition(100);
    const response = buildReadBufferResponse(screen, AID.NONE);
    expect(response[0]).toBe(AID.NONE);
    expect(response.length).toBe(3 + screen.size); // AID + cursor + all positions
  });

  it('should emit SF order for field attribute positions', () => {
    screen.setFieldAttribute(0, FieldAttr.PROTECTED);
    const response = buildReadBufferResponse(screen, AID.NONE);
    // Position 0 should be SF (0x1D) + attribute
    expect(response[3]).toBe(0x1D); // SF order
    expect(response[4]).toBe(FieldAttr.PROTECTED);
  });

  it('should emit character data for non-field positions', () => {
    screen.setChar(0, 0xC8);
    const response = buildReadBufferResponse(screen, AID.NONE);
    expect(response[3]).toBe(0xC8);
  });
});

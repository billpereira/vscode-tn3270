import { serializeScreen } from '../../../src/webview/screen-serializer';
import { ScreenBuffer } from '../../../src/emulator/screen-buffer';
import { FieldAttr, Color, Highlight } from '../../../src/emulator/field';
import { MODEL_3279_2_E, MODEL_3278_5 } from '../../../src/emulator/terminal-model';
import { encodeChar } from '../../../src/protocol/ebcdic';

describe('serializeScreen', () => {
  let screen: ScreenBuffer;

  beforeEach(() => {
    screen = new ScreenBuffer(MODEL_3279_2_E);
  });

  it('should serialize an empty screen', () => {
    const msg = serializeScreen(screen);
    expect(msg.type).toBe('screenUpdate');
    expect(msg.rows).toBe(24);
    expect(msg.cols).toBe(80);
    expect(msg.cells.length).toBe(1920);
    expect(msg.cursorPosition).toBe(0);
    expect(msg.cursorRow).toBe(0);
    expect(msg.cursorCol).toBe(0);
  });

  it('should serialize all cells as empty chars for blank screen', () => {
    const msg = serializeScreen(screen);
    for (const cell of msg.cells) {
      expect(cell.char).toBe('');
      expect(cell.isFieldAttribute).toBe(false);
    }
  });

  it('should decode EBCDIC characters to Unicode', () => {
    screen.setChar(0, encodeChar('H'));
    screen.setChar(1, encodeChar('I'));
    const msg = serializeScreen(screen);
    expect(msg.cells[0].char).toBe('H');
    expect(msg.cells[1].char).toBe('I');
  });

  it('should mark field attribute positions', () => {
    screen.setFieldAttribute(10, FieldAttr.PROTECTED);
    const msg = serializeScreen(screen);
    expect(msg.cells[10].isFieldAttribute).toBe(true);
    expect(msg.cells[10].char).toBe('');
    expect(msg.cells[11].isFieldAttribute).toBe(false);
  });

  it('should include extended attributes', () => {
    screen.setFieldAttribute(0, 0x00);
    screen.setFieldExtended(0, { foreground: Color.RED, highlight: Highlight.UNDERSCORE });
    const msg = serializeScreen(screen);
    expect(msg.cells[0].extended.foreground).toBe(Color.RED);
    expect(msg.cells[0].extended.highlight).toBe(Highlight.UNDERSCORE);
  });

  it('should include cursor position', () => {
    screen.cursor.setPosition(165); // row 2, col 5
    const msg = serializeScreen(screen);
    expect(msg.cursorPosition).toBe(165);
    expect(msg.cursorRow).toBe(2);
    expect(msg.cursorCol).toBe(5);
  });

  it('should use alternate screen dimensions', () => {
    const s = new ScreenBuffer(MODEL_3278_5);
    s.eraseWriteAlternate();
    const msg = serializeScreen(s);
    expect(msg.rows).toBe(27);
    expect(msg.cols).toBe(132);
    expect(msg.cells.length).toBe(3564);
  });

  it('should serialize a screen with mixed fields and data', () => {
    // Protected label + unprotected input
    screen.setFieldAttribute(0, FieldAttr.PROTECTED);
    screen.setChar(1, encodeChar('N'));
    screen.setChar(2, encodeChar('A'));
    screen.setChar(3, encodeChar('M'));
    screen.setChar(4, encodeChar('E'));
    screen.setFieldAttribute(10, 0x00); // unprotected
    screen.setChar(11, encodeChar('J'));
    screen.cursor.setPosition(12);

    const msg = serializeScreen(screen);
    expect(msg.cells[0].isFieldAttribute).toBe(true);
    expect(msg.cells[1].char).toBe('N');
    expect(msg.cells[4].char).toBe('E');
    expect(msg.cells[10].isFieldAttribute).toBe(true);
    expect(msg.cells[11].char).toBe('J');
    expect(msg.cursorPosition).toBe(12);
  });
});

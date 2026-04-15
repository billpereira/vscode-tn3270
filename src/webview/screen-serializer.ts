/**
 * Serializes the ScreenBuffer into CellData[] for postMessage to the webview.
 */

import { ScreenBuffer } from '../emulator/screen-buffer';
import { decodeChar } from '../protocol/ebcdic';
import type { CodePage } from '../protocol/ebcdic';
import type { CellData, ScreenUpdateMessage } from './messages';

/**
 * Serialize the screen buffer into a message for the webview.
 */
export function serializeScreen(
  screen: ScreenBuffer,
  codePage?: CodePage,
): ScreenUpdateMessage {
  const cells: CellData[] = new Array(screen.size);

  for (let i = 0; i < screen.size; i++) {
    const cell = screen.getCell(i);
    const isFieldAttr = cell.fieldAttribute >= 0;

    let char = '';
    if (!isFieldAttr && cell.char !== 0x00) {
      char = codePage
        ? decodeChar(cell.char, codePage)
        : decodeChar(cell.char);
    }

    cells[i] = {
      char,
      isFieldAttribute: isFieldAttr,
      extended: { ...cell.extended },
    };
  }

  return {
    type: 'screenUpdate',
    rows: screen.rows,
    cols: screen.cols,
    cells,
    cursorPosition: screen.cursor.position,
    cursorRow: screen.cursor.row,
    cursorCol: screen.cursor.col,
  };
}

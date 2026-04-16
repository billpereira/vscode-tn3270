/**
 * Serializes the ScreenBuffer into CellData[] for postMessage to the webview.
 */

import { ScreenBuffer } from '../emulator/screen-buffer';
import { isIntensified, isNonDisplay, Color } from '../emulator/field';
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

    // Determine effective extended attributes.
    // Basic field attribute display bits affect color when no explicit color is set.
    const extended = { ...cell.extended };
    if (!isFieldAttr) {
      const field = screen.getFieldAt(i);
      if (field) {
        if (isNonDisplay(field.attribute)) {
          // Hidden fields: set char to empty so nothing renders
          char = '';
        } else if (isIntensified(field.attribute) && extended.foreground === Color.DEFAULT) {
          // Intensified fields render as white when no explicit color
          extended.foreground = Color.WHITE;
        }
      }
    }

    cells[i] = {
      char,
      isFieldAttribute: isFieldAttr,
      extended,
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

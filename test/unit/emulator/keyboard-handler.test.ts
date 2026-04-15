/**
 * Tests for the 3270 KeyboardHandler — core input logic.
 */

import { KeyboardHandler, LockReason } from '../../../src/emulator/keyboard-handler';
import { ScreenBuffer } from '../../../src/emulator/screen-buffer';
import { FieldAttr, isModified } from '../../../src/emulator/field';
import { MODEL_3279_2_E } from '../../../src/emulator/terminal-model';
import { encodeChar } from '../../../src/protocol/ebcdic';

/** Helper: set up a screen with a protected label and an unprotected input field. */
function setupBasicScreen(): ScreenBuffer {
  const screen = new ScreenBuffer(MODEL_3279_2_E);
  // Position 0: protected field attribute
  screen.setFieldAttribute(0, FieldAttr.PROTECTED);
  // Positions 1-9: "NAME:" label
  screen.setChar(1, encodeChar('N'));
  screen.setChar(2, encodeChar('A'));
  screen.setChar(3, encodeChar('M'));
  screen.setChar(4, encodeChar('E'));
  screen.setChar(5, encodeChar(':'));
  // Position 10: unprotected field attribute
  screen.setFieldAttribute(10, 0x00);
  // Cursor at position 11 (first data position of unprotected field)
  screen.cursor.setPosition(11);
  return screen;
}

/** Helper: set up a screen with two unprotected fields. */
function setupTwoFieldScreen(): ScreenBuffer {
  const screen = new ScreenBuffer(MODEL_3279_2_E);
  screen.setFieldAttribute(0, FieldAttr.PROTECTED);
  screen.setFieldAttribute(10, 0x00); // field 1: positions 11-19
  screen.setFieldAttribute(20, FieldAttr.PROTECTED);
  screen.setFieldAttribute(30, 0x00); // field 2: positions 31-39
  screen.setFieldAttribute(40, FieldAttr.PROTECTED);
  screen.cursor.setPosition(11);
  return screen;
}

describe('KeyboardHandler – lock state', () => {
  it('should start unlocked', () => {
    const screen = new ScreenBuffer(MODEL_3279_2_E);
    const handler = new KeyboardHandler(screen);
    expect(handler.locked).toBe(false);
    expect(handler.lockReason).toBe('');
  });

  it('should lock and unlock', () => {
    const screen = new ScreenBuffer(MODEL_3279_2_E);
    const handler = new KeyboardHandler(screen);
    const lockEvents: [boolean, string][] = [];
    handler.on('lockChange', (locked, reason) => lockEvents.push([locked, reason]));

    handler.lock(LockReason.SYSTEM);
    expect(handler.locked).toBe(true);
    expect(handler.lockReason).toBe('X SYSTEM');
    expect(lockEvents).toEqual([[true, 'X SYSTEM']]);

    handler.unlock();
    expect(handler.locked).toBe(false);
    expect(lockEvents).toEqual([[true, 'X SYSTEM'], [false, '']]);
  });

  it('should ignore key input when locked', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);
    handler.lock(LockReason.SYSTEM);

    handler.handleCharInput('X');
    expect(screen.getChar(11)).toBe(0x00); // unchanged

    handler.handleNavigation('tab');
    expect(screen.cursor.position).toBe(11); // unchanged

    const sendSpy = jest.fn();
    handler.on('send', sendSpy);
    handler.handleAID('Enter');
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('KeyboardHandler – AID keys', () => {
  it('should send Enter AID and lock keyboard', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);
    const sendSpy = jest.fn();
    handler.on('send', sendSpy);

    handler.handleAID('Enter');

    expect(handler.locked).toBe(true);
    expect(handler.lockReason).toBe(LockReason.SYSTEM);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const buf: Buffer = sendSpy.mock.calls[0][0];
    expect(buf[0]).toBe(0x7D); // Enter AID code
  });

  it('should send PF key AIDs', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);
    const sendSpy = jest.fn();
    handler.on('send', sendSpy);

    handler.handleAID('PF3');
    const buf: Buffer = sendSpy.mock.calls[0][0];
    expect(buf[0]).toBe(0xF3); // PF3 AID code
  });

  it('should send PA key as short read (AID + cursor only)', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);
    // Type something to create modified data
    handler.handleCharInput('A');
    handler.unlock(); // unlock after the char input wouldn't lock, but after AID it would

    const sendSpy = jest.fn();
    handler.on('send', sendSpy);

    handler.handleAID('PA1');
    const buf: Buffer = sendSpy.mock.calls[0][0];
    // PA1 short read: AID + 2-byte cursor address = 3 bytes
    expect(buf.length).toBe(3);
    expect(buf[0]).toBe(0x6C); // PA1 AID code
  });

  it('should clear screen on Clear key', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);
    const updateSpy = jest.fn();
    handler.on('screenUpdate', updateSpy);

    handler.handleAID('Clear');
    expect(updateSpy).toHaveBeenCalled();
    expect(screen.fields.length).toBe(0); // screen cleared
  });

  it('should emit attn event for Attn key (not send data)', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);
    const attnSpy = jest.fn();
    const sendSpy = jest.fn();
    handler.on('attn', attnSpy);
    handler.on('send', sendSpy);

    handler.handleAID('Attn');
    expect(attnSpy).toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(handler.locked).toBe(false); // Attn doesn't lock
  });

  it('should emit sysreq event for SysReq key', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);
    const sysreqSpy = jest.fn();
    handler.on('sysreq', sysreqSpy);

    handler.handleAID('SysReq');
    expect(sysreqSpy).toHaveBeenCalled();
  });

  it('should ignore unknown AID names', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);
    const sendSpy = jest.fn();
    handler.on('send', sendSpy);

    handler.handleAID('Bogus');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('should include modified field data in Enter response', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);

    // Type "AB" into the unprotected field
    handler.handleCharInput('A');
    handler.handleCharInput('B');

    const sendSpy = jest.fn();
    handler.on('send', sendSpy);
    handler.handleAID('Enter');

    const buf: Buffer = sendSpy.mock.calls[0][0];
    // Should contain: AID + cursor(2) + SBA(1) + addr(2) + data
    expect(buf.length).toBeGreaterThan(3);
  });
});

describe('KeyboardHandler – navigation', () => {
  it('should tab to next unprotected field', () => {
    const screen = setupTwoFieldScreen();
    const handler = new KeyboardHandler(screen);
    screen.cursor.setPosition(11);

    handler.handleNavigation('tab');
    expect(screen.cursor.position).toBe(31);
  });

  it('should tab wrapping around', () => {
    const screen = setupTwoFieldScreen();
    const handler = new KeyboardHandler(screen);
    screen.cursor.setPosition(31);

    handler.handleNavigation('tab');
    expect(screen.cursor.position).toBe(11);
  });

  it('should backtab to previous unprotected field', () => {
    const screen = setupTwoFieldScreen();
    const handler = new KeyboardHandler(screen);
    screen.cursor.setPosition(31);

    handler.handleNavigation('backtab');
    expect(screen.cursor.position).toBe(11);
  });

  it('should backtab to start of current field if not at start', () => {
    const screen = setupTwoFieldScreen();
    const handler = new KeyboardHandler(screen);
    screen.cursor.setPosition(15); // middle of field 1

    handler.handleNavigation('backtab');
    expect(screen.cursor.position).toBe(11); // start of field 1
  });

  it('should move cursor with arrow keys', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);
    screen.cursor.setPosition(85); // row 1, col 5

    handler.handleNavigation('up');
    expect(screen.cursor.position).toBe(5); // row 0, col 5

    handler.handleNavigation('down');
    expect(screen.cursor.position).toBe(85); // back to row 1, col 5

    handler.handleNavigation('left');
    expect(screen.cursor.position).toBe(84);

    handler.handleNavigation('right');
    expect(screen.cursor.position).toBe(85);
  });

  it('should home to first unprotected field', () => {
    const screen = setupTwoFieldScreen();
    const handler = new KeyboardHandler(screen);
    screen.cursor.setPosition(35);

    handler.handleNavigation('home');
    expect(screen.cursor.position).toBe(11);
  });

  it('should end move to after last non-blank char in field', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);

    // Type "AB" at positions 11, 12
    handler.handleCharInput('A');
    handler.handleCharInput('B');
    // cursor is now at 13

    screen.cursor.setPosition(11); // go back to start
    handler.handleNavigation('end');
    expect(screen.cursor.position).toBe(13); // after 'B'
  });

  it('should handle newline as tab forward', () => {
    const screen = setupTwoFieldScreen();
    const handler = new KeyboardHandler(screen);
    screen.cursor.setPosition(11);

    handler.handleNavigation('newline');
    expect(screen.cursor.position).toBe(31);
  });
});

describe('KeyboardHandler – character input', () => {
  it('should write character at cursor position', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);

    handler.handleCharInput('X');
    expect(screen.getChar(11)).toBe(encodeChar('X'));
    expect(screen.cursor.position).toBe(12); // advanced
  });

  it('should set MDT when modifying a field', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);

    const field = screen.getFieldAt(11)!;
    expect(isModified(field.attribute)).toBe(false);

    handler.handleCharInput('A');
    expect(isModified(field.attribute)).toBe(true);
  });

  it('should reject input in protected field (operator error)', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);
    const alarmSpy = jest.fn();
    handler.on('alarm', alarmSpy);

    screen.cursor.setPosition(5); // in protected field
    handler.handleCharInput('X');

    expect(alarmSpy).toHaveBeenCalled();
    expect(handler.locked).toBe(true);
    expect(handler.lockReason).toBe(LockReason.OPERATOR_ERROR);
  });

  it('should reject non-numeric in numeric field', () => {
    const screen = new ScreenBuffer(MODEL_3279_2_E);
    screen.setFieldAttribute(0, FieldAttr.PROTECTED);
    screen.setFieldAttribute(10, FieldAttr.NUMERIC); // numeric unprotected
    screen.cursor.setPosition(11);

    const handler = new KeyboardHandler(screen);
    const alarmSpy = jest.fn();
    handler.on('alarm', alarmSpy);

    handler.handleCharInput('A');
    expect(alarmSpy).toHaveBeenCalled();
    expect(screen.getChar(11)).toBe(0x00); // unchanged
  });

  it('should accept digits in numeric field', () => {
    const screen = new ScreenBuffer(MODEL_3279_2_E);
    screen.setFieldAttribute(0, FieldAttr.PROTECTED);
    screen.setFieldAttribute(10, FieldAttr.NUMERIC);
    screen.cursor.setPosition(11);

    const handler = new KeyboardHandler(screen);
    handler.handleCharInput('5');
    expect(screen.getChar(11)).toBe(encodeChar('5'));
  });

  it('should accept special chars in numeric field (., -, +)', () => {
    const screen = new ScreenBuffer(MODEL_3279_2_E);
    screen.setFieldAttribute(0, FieldAttr.PROTECTED);
    screen.setFieldAttribute(10, FieldAttr.NUMERIC);
    screen.cursor.setPosition(11);

    const handler = new KeyboardHandler(screen);
    handler.handleCharInput('.');
    expect(screen.getChar(11)).toBe(encodeChar('.'));
  });

  it('should type multiple characters sequentially', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);

    handler.handleCharInput('H');
    handler.handleCharInput('I');
    expect(screen.getChar(11)).toBe(encodeChar('H'));
    expect(screen.getChar(12)).toBe(encodeChar('I'));
    expect(screen.cursor.position).toBe(13);
  });

  it('should emit screenUpdate on character input', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);
    const updateSpy = jest.fn();
    handler.on('screenUpdate', updateSpy);

    handler.handleCharInput('A');
    expect(updateSpy).toHaveBeenCalled();
  });
});

describe('KeyboardHandler – insert mode', () => {
  it('should start in overtype mode', () => {
    const screen = new ScreenBuffer(MODEL_3279_2_E);
    const handler = new KeyboardHandler(screen);
    expect(handler.insertMode).toBe(false);
  });

  it('should toggle insert mode', () => {
    const screen = new ScreenBuffer(MODEL_3279_2_E);
    const handler = new KeyboardHandler(screen);
    const insertSpy = jest.fn();
    handler.on('insertModeChange', insertSpy);

    handler.handleEditAction('insertToggle');
    expect(handler.insertMode).toBe(true);
    expect(insertSpy).toHaveBeenCalledWith(true);

    handler.handleEditAction('insertToggle');
    expect(handler.insertMode).toBe(false);
    expect(insertSpy).toHaveBeenCalledWith(false);
  });

  it('should shift characters right in insert mode', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);

    // Type "AC" at positions 11, 12
    handler.handleCharInput('A');
    handler.handleCharInput('C');

    // Go back to position 11, enable insert, type "B"
    screen.cursor.setPosition(12);
    handler.handleEditAction('insertToggle');
    handler.handleCharInput('B');

    // Should now be "A", "B", "C"
    expect(screen.getChar(11)).toBe(encodeChar('A'));
    expect(screen.getChar(12)).toBe(encodeChar('B'));
    expect(screen.getChar(13)).toBe(encodeChar('C'));
  });

  it('should error on insert overflow', () => {
    // Create a very short unprotected field (2 data positions)
    const screen = new ScreenBuffer(MODEL_3279_2_E);
    screen.setFieldAttribute(0, FieldAttr.PROTECTED);
    screen.setFieldAttribute(10, 0x00);
    screen.setFieldAttribute(12, FieldAttr.PROTECTED); // only positions 11 is data
    screen.cursor.setPosition(11);

    const handler = new KeyboardHandler(screen);

    // Fill the field
    handler.handleCharInput('A');
    screen.cursor.setPosition(11);

    // Enable insert and try to insert — should overflow
    handler.handleEditAction('insertToggle');
    const alarmSpy = jest.fn();
    handler.on('alarm', alarmSpy);

    handler.handleCharInput('B');
    expect(alarmSpy).toHaveBeenCalled();
  });
});

describe('KeyboardHandler – edit actions', () => {
  it('should delete character at cursor', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);

    handler.handleCharInput('A');
    handler.handleCharInput('B');
    handler.handleCharInput('C');
    // cursor at 14, data: A=11, B=12, C=13

    screen.cursor.setPosition(12); // on 'B'
    handler.handleEditAction('delete');

    expect(screen.getChar(12)).toBe(encodeChar('C')); // C shifted left
    expect(screen.getChar(13)).toBe(0x00); // cleared
  });

  it('should backspace (move left + delete)', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);

    handler.handleCharInput('A');
    handler.handleCharInput('B');
    // cursor at 13, data: A=11, B=12

    handler.handleEditAction('backspace');
    // cursor should be at 12, B deleted
    expect(screen.cursor.position).toBe(12);
    expect(screen.getChar(12)).toBe(0x00);
  });

  it('should not backspace past field start', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);
    screen.cursor.setPosition(11); // at field start

    handler.handleEditAction('backspace');
    expect(screen.cursor.position).toBe(11); // unchanged
  });

  it('should erase to end of field', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);

    handler.handleCharInput('A');
    handler.handleCharInput('B');
    handler.handleCharInput('C');
    handler.handleCharInput('D');

    screen.cursor.setPosition(12); // after 'A'
    handler.handleEditAction('eraseEOF');

    expect(screen.getChar(11)).toBe(encodeChar('A'));
    expect(screen.getChar(12)).toBe(0x00);
    expect(screen.getChar(13)).toBe(0x00);
    expect(screen.getChar(14)).toBe(0x00);
  });

  it('should erase input (all unprotected fields)', () => {
    const screen = setupTwoFieldScreen();
    const handler = new KeyboardHandler(screen);

    screen.cursor.setPosition(11);
    handler.handleCharInput('X');
    screen.cursor.setPosition(31);
    handler.handleCharInput('Y');

    handler.handleEditAction('eraseInput');
    expect(screen.getChar(11)).toBe(0x00);
    expect(screen.getChar(31)).toBe(0x00);
  });

  it('should error on delete in protected field', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);
    const alarmSpy = jest.fn();
    handler.on('alarm', alarmSpy);

    screen.cursor.setPosition(5); // protected
    handler.handleEditAction('delete');
    expect(alarmSpy).toHaveBeenCalled();
  });
});

describe('KeyboardHandler – reset', () => {
  it('should clear operator error on reset', () => {
    const screen = setupBasicScreen();
    const handler = new KeyboardHandler(screen);

    // Trigger operator error
    screen.cursor.setPosition(5);
    handler.handleCharInput('X');
    expect(handler.locked).toBe(true);
    expect(handler.lockReason).toBe(LockReason.OPERATOR_ERROR);

    handler.handleReset();
    expect(handler.locked).toBe(false);
  });

  it('should not clear system lock on reset', () => {
    const screen = new ScreenBuffer(MODEL_3279_2_E);
    const handler = new KeyboardHandler(screen);

    handler.lock(LockReason.SYSTEM);
    handler.handleReset();
    expect(handler.locked).toBe(true); // still locked
  });
});

describe('KeyboardHandler – setScreen', () => {
  it('should allow switching screen buffers', () => {
    const screen1 = setupBasicScreen();
    const screen2 = setupBasicScreen();
    const handler = new KeyboardHandler(screen1);

    handler.setScreen(screen2);
    screen2.cursor.setPosition(11);
    handler.handleCharInput('Z');
    expect(screen2.getChar(11)).toBe(encodeChar('Z'));
    expect(screen1.getChar(11)).toBe(0x00); // unchanged
  });
});

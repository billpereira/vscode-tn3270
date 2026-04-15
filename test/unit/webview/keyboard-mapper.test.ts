/**
 * Tests for the keyboard mapper — physical key → 3270 action translation.
 */

import {
  mapKeyPress,
  getDefaultKeyMap,
  createKeyMap,
  bindingKey,
  type KeyBinding,
  type ActionType,
} from '../../../src/webview/keyboard-mapper';
import type { KeyPressMessage } from '../../../src/webview/messages';

/** Helper to create a KeyPressMessage. */
function keyEvent(
  key: string,
  shift = false,
  ctrl = false,
  alt = false,
): KeyPressMessage {
  return { type: 'keyPress', key, shift, ctrl, alt };
}

describe('bindingKey', () => {
  it('should build plain key', () => {
    expect(bindingKey('a')).toBe('a');
  });

  it('should include modifiers', () => {
    expect(bindingKey('a', true, true, true)).toBe('C-A-S-a');
  });

  it('should include only ctrl', () => {
    expect(bindingKey('c', false, true)).toBe('C-c');
  });

  it('should include only shift', () => {
    expect(bindingKey('F1', true)).toBe('S-F1');
  });
});

describe('mapKeyPress – AID keys', () => {
  it('should map Enter to AID Enter', () => {
    const result = mapKeyPress(keyEvent('Enter'));
    expect(result).toEqual({ type: 'aidKey', aid: 'Enter' });
  });

  it('should map F1 to PF1', () => {
    const result = mapKeyPress(keyEvent('F1'));
    expect(result).toEqual({ type: 'aidKey', aid: 'PF1' });
  });

  it('should map F12 to PF12', () => {
    const result = mapKeyPress(keyEvent('F12'));
    expect(result).toEqual({ type: 'aidKey', aid: 'PF12' });
  });

  it('should map Shift+F1 to PF13', () => {
    const result = mapKeyPress(keyEvent('F1', true));
    expect(result).toEqual({ type: 'aidKey', aid: 'PF13' });
  });

  it('should map Shift+F12 to PF24', () => {
    const result = mapKeyPress(keyEvent('F12', true));
    expect(result).toEqual({ type: 'aidKey', aid: 'PF24' });
  });

  it('should map Escape to Clear', () => {
    const result = mapKeyPress(keyEvent('Escape'));
    expect(result).toEqual({ type: 'aidKey', aid: 'Clear' });
  });

  it('should map Ctrl+A to Attn', () => {
    const result = mapKeyPress(keyEvent('a', false, true));
    expect(result).toEqual({ type: 'aidKey', aid: 'Attn' });
  });

  it('should map Ctrl+S to SysReq', () => {
    const result = mapKeyPress(keyEvent('s', false, true));
    expect(result).toEqual({ type: 'aidKey', aid: 'SysReq' });
  });

  it('should map Alt+1/2/3 to PA1/PA2/PA3', () => {
    expect(mapKeyPress(keyEvent('1', false, false, true))).toEqual({ type: 'aidKey', aid: 'PA1' });
    expect(mapKeyPress(keyEvent('2', false, false, true))).toEqual({ type: 'aidKey', aid: 'PA2' });
    expect(mapKeyPress(keyEvent('3', false, false, true))).toEqual({ type: 'aidKey', aid: 'PA3' });
  });
});

describe('mapKeyPress – navigation', () => {
  it('should map Tab to tab', () => {
    expect(mapKeyPress(keyEvent('Tab'))).toEqual({ type: 'navigation', action: 'tab' });
  });

  it('should map Shift+Tab to backtab', () => {
    expect(mapKeyPress(keyEvent('Tab', true))).toEqual({ type: 'navigation', action: 'backtab' });
  });

  it('should map arrow keys', () => {
    expect(mapKeyPress(keyEvent('ArrowUp'))).toEqual({ type: 'navigation', action: 'up' });
    expect(mapKeyPress(keyEvent('ArrowDown'))).toEqual({ type: 'navigation', action: 'down' });
    expect(mapKeyPress(keyEvent('ArrowLeft'))).toEqual({ type: 'navigation', action: 'left' });
    expect(mapKeyPress(keyEvent('ArrowRight'))).toEqual({ type: 'navigation', action: 'right' });
  });

  it('should map Home and End', () => {
    expect(mapKeyPress(keyEvent('Home'))).toEqual({ type: 'navigation', action: 'home' });
    expect(mapKeyPress(keyEvent('End'))).toEqual({ type: 'navigation', action: 'end' });
  });
});

describe('mapKeyPress – edit actions', () => {
  it('should map Delete to delete', () => {
    expect(mapKeyPress(keyEvent('Delete'))).toEqual({ type: 'editAction', action: 'delete' });
  });

  it('should map Backspace to backspace', () => {
    expect(mapKeyPress(keyEvent('Backspace'))).toEqual({ type: 'editAction', action: 'backspace' });
  });

  it('should map Insert to insertToggle', () => {
    expect(mapKeyPress(keyEvent('Insert'))).toEqual({ type: 'editAction', action: 'insertToggle' });
  });

  it('should map Ctrl+E to eraseEOF', () => {
    expect(mapKeyPress(keyEvent('e', false, true))).toEqual({ type: 'editAction', action: 'eraseEOF' });
  });

  it('should map Ctrl+I to eraseInput', () => {
    expect(mapKeyPress(keyEvent('i', false, true))).toEqual({ type: 'editAction', action: 'eraseInput' });
  });
});

describe('mapKeyPress – reset', () => {
  it('should map Ctrl+R to reset', () => {
    expect(mapKeyPress(keyEvent('r', false, true))).toEqual({ type: 'reset' });
  });
});

describe('mapKeyPress – character input', () => {
  it('should map single printable characters to charInput', () => {
    expect(mapKeyPress(keyEvent('a'))).toEqual({ type: 'charInput', char: 'a' });
    expect(mapKeyPress(keyEvent('Z'))).toEqual({ type: 'charInput', char: 'Z' });
    expect(mapKeyPress(keyEvent('5'))).toEqual({ type: 'charInput', char: '5' });
    expect(mapKeyPress(keyEvent('@'))).toEqual({ type: 'charInput', char: '@' });
  });

  it('should return null for modifier-only keys', () => {
    expect(mapKeyPress(keyEvent('Shift'))).toBeNull();
    expect(mapKeyPress(keyEvent('Control'))).toBeNull();
    expect(mapKeyPress(keyEvent('Alt'))).toBeNull();
    expect(mapKeyPress(keyEvent('Meta'))).toBeNull();
  });

  it('should not map Ctrl+letter as character input', () => {
    // Ctrl+X is not mapped in defaults, should not become charInput
    const result = mapKeyPress(keyEvent('x', false, true));
    expect(result).toBeNull();
  });

  it('should not map Alt+letter as character input', () => {
    // Alt+z is not mapped, should not become charInput
    const result = mapKeyPress(keyEvent('z', false, false, true));
    expect(result).toBeNull();
  });
});

describe('getDefaultKeyMap', () => {
  it('should return the same instance on repeated calls', () => {
    const km1 = getDefaultKeyMap();
    const km2 = getDefaultKeyMap();
    expect(km1).toBe(km2);
  });

  it('should have all PF key bindings', () => {
    const km = getDefaultKeyMap();
    for (let i = 1; i <= 12; i++) {
      expect(km.bindings.has(bindingKey(`F${i}`))).toBe(true);
      expect(km.bindings.has(bindingKey(`F${i}`, true))).toBe(true);
    }
  });
});

describe('createKeyMap', () => {
  it('should allow overriding default bindings', () => {
    const km = createKeyMap([
      { binding: { key: 'Enter' }, action: { type: 'aid', aid: 'PF1' } },
    ]);
    const result = mapKeyPress(keyEvent('Enter'), km);
    expect(result).toEqual({ type: 'aidKey', aid: 'PF1' });
  });

  it('should add new bindings', () => {
    const km = createKeyMap([
      { binding: { key: 'F13' }, action: { type: 'aid', aid: 'PA1' } },
    ]);
    const result = mapKeyPress(keyEvent('F13'), km);
    expect(result).toEqual({ type: 'aidKey', aid: 'PA1' });
  });

  it('should preserve existing bindings not overridden', () => {
    const km = createKeyMap([]);
    const result = mapKeyPress(keyEvent('F1'), km);
    expect(result).toEqual({ type: 'aidKey', aid: 'PF1' });
  });
});

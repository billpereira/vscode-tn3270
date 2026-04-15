/**
 * Maps physical keyboard events to 3270 terminal actions.
 *
 * Translates KeyPressMessage from the webview into typed messages:
 * AIDKeyMessage, NavigationMessage, CharInputMessage, or EditActionMessage.
 *
 * Keybindings are configurable — the default map matches common 3270
 * emulator conventions.
 */

import type {
  KeyPressMessage,
  AIDKeyMessage,
  CharInputMessage,
  NavigationMessage,
  EditActionMessage,
  WebviewToHostMessage,
} from './messages';

// ── Key binding types ─────────────────────────────────────────────

export interface KeyBinding {
  key: string;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
}

export type ActionType =
  | { type: 'aid'; aid: string }
  | { type: 'navigation'; action: NavigationMessage['action'] }
  | { type: 'edit'; action: EditActionMessage['action'] }
  | { type: 'reset' };

export interface KeyMap {
  bindings: Map<string, ActionType>;
}

// ── Default key bindings ─────────────────────────────────────────

function bindingKey(key: string, shift = false, ctrl = false, alt = false): string {
  return `${ctrl ? 'C-' : ''}${alt ? 'A-' : ''}${shift ? 'S-' : ''}${key}`;
}

function createDefaultKeyMap(): KeyMap {
  const bindings = new Map<string, ActionType>();

  // AID keys
  bindings.set(bindingKey('Enter'), { type: 'aid', aid: 'Enter' });

  // PF1-PF12 → F1-F12
  for (let i = 1; i <= 12; i++) {
    bindings.set(bindingKey(`F${i}`), { type: 'aid', aid: `PF${i}` });
  }

  // PF13-PF24 → Shift+F1-F12
  for (let i = 1; i <= 12; i++) {
    bindings.set(bindingKey(`F${i}`, true), { type: 'aid', aid: `PF${i + 12}` });
  }

  // PA keys
  bindings.set(bindingKey('1', false, false, true), { type: 'aid', aid: 'PA1' });
  bindings.set(bindingKey('2', false, false, true), { type: 'aid', aid: 'PA2' });
  bindings.set(bindingKey('3', false, false, true), { type: 'aid', aid: 'PA3' });

  // Clear, Attn, SysReq
  bindings.set(bindingKey('Escape'), { type: 'aid', aid: 'Clear' });
  bindings.set(bindingKey('a', false, true), { type: 'aid', aid: 'Attn' });
  bindings.set(bindingKey('s', false, true), { type: 'aid', aid: 'SysReq' });

  // Navigation
  bindings.set(bindingKey('Tab'), { type: 'navigation', action: 'tab' });
  bindings.set(bindingKey('Tab', true), { type: 'navigation', action: 'backtab' });
  bindings.set(bindingKey('ArrowUp'), { type: 'navigation', action: 'up' });
  bindings.set(bindingKey('ArrowDown'), { type: 'navigation', action: 'down' });
  bindings.set(bindingKey('ArrowLeft'), { type: 'navigation', action: 'left' });
  bindings.set(bindingKey('ArrowRight'), { type: 'navigation', action: 'right' });
  bindings.set(bindingKey('Home'), { type: 'navigation', action: 'home' });
  bindings.set(bindingKey('End'), { type: 'navigation', action: 'end' });

  // Edit actions
  bindings.set(bindingKey('Delete'), { type: 'edit', action: 'delete' });
  bindings.set(bindingKey('Backspace'), { type: 'edit', action: 'backspace' });
  bindings.set(bindingKey('Insert'), { type: 'edit', action: 'insertToggle' });
  bindings.set(bindingKey('e', false, true), { type: 'edit', action: 'eraseEOF' });
  bindings.set(bindingKey('i', false, true), { type: 'edit', action: 'eraseInput' });

  // Reset (clear operator error lock)
  bindings.set(bindingKey('r', false, true), { type: 'reset' });

  return { bindings };
}

let _defaultKeyMap: KeyMap | null = null;

/** Get the default key map (lazily created). */
export function getDefaultKeyMap(): KeyMap {
  if (!_defaultKeyMap) {
    _defaultKeyMap = createDefaultKeyMap();
  }
  return _defaultKeyMap;
}

/** Create a key map with custom bindings merged over defaults. */
export function createKeyMap(overrides: Array<{ binding: KeyBinding; action: ActionType }>): KeyMap {
  const base = createDefaultKeyMap();
  for (const { binding, action } of overrides) {
    const key = bindingKey(binding.key, binding.shift, binding.ctrl, binding.alt);
    base.bindings.set(key, action);
  }
  return base;
}

// ── Key event → message translation ──────────────────────────────

/**
 * Map a key press event to a 3270 action message.
 * Returns null if the key doesn't map to anything (e.g. modifier-only key).
 */
export function mapKeyPress(
  event: KeyPressMessage,
  keyMap: KeyMap = getDefaultKeyMap(),
): WebviewToHostMessage | { type: 'reset' } | null {
  // Build the lookup key
  const key = bindingKey(event.key, event.shift, event.ctrl, event.alt);
  const action = keyMap.bindings.get(key);

  if (action) {
    switch (action.type) {
      case 'aid':
        return { type: 'aidKey', aid: action.aid } as AIDKeyMessage;
      case 'navigation':
        return { type: 'navigation', action: action.action } as NavigationMessage;
      case 'edit':
        return { type: 'editAction', action: action.action } as EditActionMessage;
      case 'reset':
        return { type: 'reset' };
    }
  }

  // If no binding matched but it's a single printable character (no ctrl/alt),
  // treat it as character input
  if (!event.ctrl && !event.alt && event.key.length === 1) {
    return { type: 'charInput', char: event.key } as CharInputMessage;
  }

  // Unrecognized key — ignore
  return null;
}

// ── Exported for testing ─────────────────────────────────────────

export { bindingKey };

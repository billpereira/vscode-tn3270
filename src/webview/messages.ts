/**
 * PostMessage protocol types between Extension Host and Webview.
 *
 * Host → Webview: screen updates, connection state, theme changes.
 * Webview → Host: keystrokes, resize events.
 */

import type { ExtendedAttributes } from '../emulator/field';

// ── Host → Webview messages ─────────────────────────────────────────

/** Cell data for a single screen position. */
export interface CellData {
  char: string;           // Unicode character
  isFieldAttribute: boolean;
  extended: ExtendedAttributes;
}

/** Full screen update sent after processing a Write command. */
export interface ScreenUpdateMessage {
  type: 'screenUpdate';
  rows: number;
  cols: number;
  cells: CellData[];
  cursorPosition: number;
  cursorRow: number;
  cursorCol: number;
}

/** Connection state change. */
export interface ConnectionStateMessage {
  type: 'connectionState';
  state: 'connected' | 'connecting' | 'disconnected' | 'error';
  sessionName: string;
}

/** Keyboard lock/unlock state. */
export interface KeyboardStateMessage {
  type: 'keyboardState';
  locked: boolean;
  reason: string; // e.g. 'X SYSTEM', 'X WAIT', ''
}

/** Sound the terminal alarm. */
export interface AlarmMessage {
  type: 'alarm';
}

/** Theme configuration from the Extension Host. */
export interface ThemeMessage {
  type: 'theme';
  kind: 'dark' | 'light' | 'highContrast' | 'highContrastLight';
  colors: ThemeColors;
}

/** Terminal color palette. */
export interface ThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  // 3270 standard colors
  blue: string;
  red: string;
  pink: string;
  green: string;
  turquoise: string;
  yellow: string;
  white: string;
  // OIA
  oiaBackground: string;
  oiaForeground: string;
}

/** OIA (Operator Information Area) update. */
export interface OIAMessage {
  type: 'oiaUpdate';
  connected: boolean;
  cursorRow: number;
  cursorCol: number;
  insertMode: boolean;
  terminalModel: string;
  keyboardLocked: boolean;
  lockReason: string;
}

export type HostToWebviewMessage =
  | ScreenUpdateMessage
  | ConnectionStateMessage
  | KeyboardStateMessage
  | AlarmMessage
  | ThemeMessage
  | OIAMessage;

// ── Webview → Host messages ─────────────────────────────────────────

/** A key press in the terminal. */
export interface KeyPressMessage {
  type: 'keyPress';
  key: string;      // Key identifier (e.g. 'Enter', 'PF1', 'a')
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** An AID key press (Enter, PF, PA, Clear, etc.). */
export interface AIDKeyMessage {
  type: 'aidKey';
  aid: string; // AID name: 'Enter', 'PF1'..'PF24', 'PA1'..'PA3', 'Clear', 'Attn', 'SysReq'
}

/** Character typed into an unprotected field. */
export interface CharInputMessage {
  type: 'charInput';
  char: string;
}

/** Field navigation action. */
export interface NavigationMessage {
  type: 'navigation';
  action: 'tab' | 'backtab' | 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'newline';
}

/** Editing action. */
export interface EditActionMessage {
  type: 'editAction';
  action: 'delete' | 'backspace' | 'eraseEOF' | 'eraseInput' | 'insertToggle';
}

export type WebviewToHostMessage =
  | KeyPressMessage
  | AIDKeyMessage
  | CharInputMessage
  | NavigationMessage
  | EditActionMessage;

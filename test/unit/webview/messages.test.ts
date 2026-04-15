import type {
  HostToWebviewMessage, WebviewToHostMessage,
  ScreenUpdateMessage, ConnectionStateMessage, KeyboardStateMessage,
  AlarmMessage, ThemeMessage, OIAMessage,
  KeyPressMessage, AIDKeyMessage, CharInputMessage,
  NavigationMessage, EditActionMessage, CellData,
} from '../../../src/webview/messages';
import { Color, Highlight } from '../../../src/emulator/field';

describe('message types', () => {
  describe('Host → Webview messages', () => {
    it('should define ScreenUpdateMessage', () => {
      const cell: CellData = {
        char: 'H',
        isFieldAttribute: false,
        extended: { foreground: Color.GREEN, background: Color.DEFAULT, highlight: Highlight.DEFAULT },
      };
      const msg: ScreenUpdateMessage = {
        type: 'screenUpdate',
        rows: 24,
        cols: 80,
        cells: [cell],
        cursorPosition: 0,
        cursorRow: 0,
        cursorCol: 0,
      };
      expect(msg.type).toBe('screenUpdate');
      expect(msg.cells[0].char).toBe('H');
    });

    it('should define ConnectionStateMessage', () => {
      const msg: ConnectionStateMessage = {
        type: 'connectionState',
        state: 'connected',
        sessionName: 'MyHost',
      };
      expect(msg.type).toBe('connectionState');
      expect(msg.state).toBe('connected');
    });

    it('should define KeyboardStateMessage', () => {
      const msg: KeyboardStateMessage = {
        type: 'keyboardState',
        locked: true,
        reason: 'X SYSTEM',
      };
      expect(msg.locked).toBe(true);
    });

    it('should define AlarmMessage', () => {
      const msg: AlarmMessage = { type: 'alarm' };
      expect(msg.type).toBe('alarm');
    });

    it('should define ThemeMessage', () => {
      const msg: ThemeMessage = {
        type: 'theme',
        kind: 'dark',
        colors: {
          background: '#000000',
          foreground: '#33ff33',
          cursor: '#33ff33',
          blue: '#5555ff', red: '#ff5555', pink: '#ff55ff',
          green: '#33ff33', turquoise: '#55ffff', yellow: '#ffff55',
          white: '#ffffff',
          oiaBackground: '#007acc', oiaForeground: '#ffffff',
        },
      };
      expect(msg.kind).toBe('dark');
      expect(msg.colors.green).toBe('#33ff33');
    });

    it('should define OIAMessage', () => {
      const msg: OIAMessage = {
        type: 'oiaUpdate',
        connected: true,
        cursorRow: 5,
        cursorCol: 10,
        insertMode: false,
        terminalModel: 'IBM-3279-2-E',
        keyboardLocked: false,
        lockReason: '',
      };
      expect(msg.terminalModel).toBe('IBM-3279-2-E');
    });

    it('should discriminate via type field', () => {
      const messages: HostToWebviewMessage[] = [
        { type: 'screenUpdate', rows: 24, cols: 80, cells: [], cursorPosition: 0, cursorRow: 0, cursorCol: 0 },
        { type: 'connectionState', state: 'connected', sessionName: 'test' },
        { type: 'alarm' },
      ];
      expect(messages.map(m => m.type)).toEqual(['screenUpdate', 'connectionState', 'alarm']);
    });
  });

  describe('Webview → Host messages', () => {
    it('should define KeyPressMessage', () => {
      const msg: KeyPressMessage = {
        type: 'keyPress', key: 'F1', shift: false, ctrl: false, alt: false,
      };
      expect(msg.key).toBe('F1');
    });

    it('should define AIDKeyMessage', () => {
      const msg: AIDKeyMessage = { type: 'aidKey', aid: 'Enter' };
      expect(msg.aid).toBe('Enter');
    });

    it('should define CharInputMessage', () => {
      const msg: CharInputMessage = { type: 'charInput', char: 'A' };
      expect(msg.char).toBe('A');
    });

    it('should define NavigationMessage', () => {
      const msg: NavigationMessage = { type: 'navigation', action: 'tab' };
      expect(msg.action).toBe('tab');
    });

    it('should define EditActionMessage', () => {
      const msg: EditActionMessage = { type: 'editAction', action: 'delete' };
      expect(msg.action).toBe('delete');
    });

    it('should discriminate via type field', () => {
      const messages: WebviewToHostMessage[] = [
        { type: 'keyPress', key: 'a', shift: false, ctrl: false, alt: false },
        { type: 'aidKey', aid: 'PF1' },
        { type: 'charInput', char: 'B' },
        { type: 'navigation', action: 'tab' },
        { type: 'editAction', action: 'backspace' },
      ];
      expect(messages.map(m => m.type)).toEqual([
        'keyPress', 'aidKey', 'charInput', 'navigation', 'editAction',
      ]);
    });
  });
});

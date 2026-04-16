/**
 * Session lifecycle management.
 *
 * Creates, tracks, and disposes TN3270 sessions. Each session has
 * its own Connection, ScreenBuffer, KeyboardHandler, and WebviewPanel.
 * Supports multiple concurrent sessions in separate tabs.
 */

import * as vscode from 'vscode';
import { Connection, ConnectionState, type ConnectionConfig } from './connection';
import type { SessionProfile } from './session-profile';
import { ScreenBuffer } from '../emulator/screen-buffer';
import { KeyboardHandler } from '../emulator/keyboard-handler';
import { getModel } from '../emulator/terminal-model';
import { PanelManager } from '../webview/panel-manager';
import { serializeScreen } from '../webview/screen-serializer';
import { buildThemeMessage } from '../webview/theme';
import { mapKeyPress } from '../webview/keyboard-mapper';
import { TelnetNegotiator } from '../protocol/telnet';
import { processRecord, DatastreamAction, WCC } from '../protocol/datastream';
import {
  TN3270EDataType,
  TN3270ERequestFlag,
  TN3270EResponseFlag,
  stripHeader,
  buildHeader,
} from '../protocol/tn3270e';
import { getCodePage, encodeChar } from '../protocol/ebcdic';
import type { WebviewToHostMessage, KeyPressMessage } from '../webview/messages';
import { log, logHex } from './logger';

// ── Session ───────────────────────────────────────────────────────

export class Session {
  readonly id: string;
  readonly profile: SessionProfile;
  readonly connection: Connection;
  readonly screen: ScreenBuffer;
  readonly keyboard: KeyboardHandler;
  readonly telnet: TelnetNegotiator;

  private _panel: PanelManager | null = null;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempts: number = 0;
  private _manualDisconnect: boolean = false;
  private _disposed: boolean = false;
  private _sscpLuMode: boolean = false;

  static readonly MAX_RECONNECT_ATTEMPTS = 5;
  static readonly RECONNECT_BASE_DELAY = 1000; // ms

  constructor(profile: SessionProfile, extensionUri: vscode.Uri) {
    this.id = `${profile.name}-${Date.now()}`;
    this.profile = profile;

    const model = getModel(profile.model);
    this.screen = new ScreenBuffer(model);
    this.keyboard = new KeyboardHandler(this.screen);
    this.connection = new Connection();
    this.telnet = new TelnetNegotiator(profile.model, profile.luName || '');

    this._panel = new PanelManager(
      extensionUri,
      (msg) => this.handleWebviewMessage(msg),
      () => this.dispose(),
    );

    this.wireEvents();
  }

  get isConnected(): boolean {
    return this.connection.isConnected;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  /** Create the webview panel and connect. */
  start(): void {
    this._panel!.createPanel(this.profile.name);
    this.sendTheme();
    this.connect();
  }

  /** Connect to the host. */
  connect(): void {
    this._manualDisconnect = false;
    this._reconnectAttempts = 0;

    const config: ConnectionConfig = {
      host: this.profile.host,
      port: this.profile.port,
      tls: this.profile.tls,
      tlsVerify: this.profile.tlsVerify,
    };

    log('CONN', `Connecting to ${config.host}:${config.port} (TLS: ${config.tls})`);
    this.connection.connect(config);
    this.updatePanelTitle();
  }

  /** Manually disconnect (does NOT trigger auto-reconnect). */
  disconnect(): void {
    this._manualDisconnect = true;
    this.cancelReconnect();
    this.connection.disconnect();
    this.keyboard.unlock();
    this.updatePanelTitle();
  }

  /** Dispose of all resources. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.cancelReconnect();
    this.connection.dispose();
    this._panel?.dispose();
    this.keyboard.removeAllListeners();
  }

  // ── Event wiring ─────────────────────────────────────────────

  private wireEvents(): void {
    // Connection → Telnet → Screen
    this.connection.on('data', (data: Buffer) => {
      this.telnet.processData(data);
    });

    this.connection.on('stateChange', (state: ConnectionState) => {
      log('CONN', `State: ${state} (session: ${this.profile.name})`);
      this._panel?.postMessage({
        type: 'connectionState',
        state,
        sessionName: this.profile.name,
      });
      this.updatePanelTitle();

      if (state === ConnectionState.Disconnected && !this._manualDisconnect) {
        this.attemptReconnect();
      }
    });

    this.connection.on('error', (err: Error) => {
      log('CONN', `Error: ${err.message}`);
    });

    // Telnet negotiation responses → send to host
    this.telnet.on('send', (data: Buffer) => {
      logHex('TELNET', 'Send', data);
      this.connection.send(data);
    });

    this.telnet.on('negotiated', () => {
      log('TELNET', `Negotiation complete (TN3270E: ${this.telnet.isTN3270E})`);
    });

    this.telnet.on('debug', (message: string) => {
      log('TELNET', message);
    });

    this.telnet.on('tn3270eNegotiated', () => {
      const neg = this.telnet.tn3270eNegotiator;
      log('TN3270E', `Negotiated — device: ${neg?.deviceType}, LU: ${neg?.luName || '(none)'}, functions: [${neg?.agreedFunctions}]`);
    });

    // Telnet records → datastream processing
    this.telnet.on('record', (record: Buffer) => {
      logHex('RECORD', `Recv (TN3270E: ${this.telnet.isTN3270E})`, record);
      this.processHostRecord(record);
    });

    // Keyboard → send response to host
    this.keyboard.on('send', (data: Buffer) => {
      logHex('KEYBOARD', 'AID response', data);
      let payload = data;

      // TN3270E mode: prepend 5-byte header
      if (this.telnet.isTN3270E) {
        const header = buildHeader({
          dataType: TN3270EDataType.DATA_3270,
          requestFlag: TN3270ERequestFlag.NO_RESPONSE,
          responseFlag: TN3270EResponseFlag.NO_RESPONSE,
          seqNumber: 0,
        });
        payload = Buffer.concat([header, data]);
      }

      // Wrap in IAC EOR for Telnet
      const eor = Buffer.from([0xFF, 0xEF]);
      this.connection.send(Buffer.concat([payload, eor]));
    });

    this.keyboard.on('lockChange', (locked: boolean, reason: string) => {
      this._panel?.postMessage({
        type: 'keyboardState',
        locked,
        reason,
      });
    });

    this.keyboard.on('alarm', () => {
      this._panel?.postMessage({ type: 'alarm' });
    });

    this.keyboard.on('screenUpdate', () => {
      this.sendScreenUpdate();
    });

    this.keyboard.on('attn', () => {
      // Attn: send IAC IP (Telnet Interrupt Process)
      this.connection.send(Buffer.from([0xFF, 0xF4]));
    });
  }

  // ── Host record processing ──────────────────────────────────

  private processHostRecord(record: Buffer): void {
    let payload = record;

    // TN3270E mode: strip the 5-byte header
    if (this.telnet.isTN3270E) {
      const parsed = stripHeader(record);
      if (!parsed) {
        log('TN3270E', 'Record too short to contain header, skipping');
        return;
      }

      const typeNames: Record<number, string> = {
        0x00: 'DATA_3270', 0x01: 'DATA_SCS', 0x02: 'DATA_RESPONSE',
        0x03: 'DATA_BIND', 0x04: 'DATA_UNBIND', 0x05: 'DATA_NVT',
        0x06: 'DATA_REQUEST', 0x07: 'DATA_SSCP_LU',
      };
      log('TN3270E', `Header: type=${typeNames[parsed.header.dataType] ?? parsed.header.dataType} req=${parsed.header.requestFlag} resp=${parsed.header.responseFlag} seq=${parsed.header.seqNumber} payload=${parsed.payload.length}b`);

      if (parsed.header.dataType === TN3270EDataType.DATA_SSCP_LU) {
        // SSCP-LU data: raw EBCDIC text (login/USS screens).
        // Write characters at cursor position and unlock keyboard.
        this._sscpLuMode = true;
        this.processSscpLuData(parsed.payload);
        return;
      }

      if (parsed.header.dataType === TN3270EDataType.DATA_BIND) {
        // BIND: session (re)binding — unlock keyboard for incoming screen
        this.keyboard.unlock();
        return;
      }

      if (parsed.header.dataType === TN3270EDataType.DATA_UNBIND) {
        // UNBIND: session unbinding — will be followed by BIND
        return;
      }

      if (parsed.header.dataType === TN3270EDataType.DATA_3270) {
        this._sscpLuMode = false;
        payload = parsed.payload;
      } else {
        // Other types (SCS, NVT, RESPONSE, etc.) — ignore for now
        return;
      }
    }

    const result = processRecord(payload, this.screen);
    log('RECORD', `Processed: actions=[${result.actions.map(a => DatastreamAction[a]).join(',')}] wcc=0x${result.wcc.toString(16)} restoreKb=${!!(result.wcc & WCC.RESTORE_KB)}`);

    for (const action of result.actions) {
      switch (action) {
        case DatastreamAction.ScreenUpdate:
          this.sendScreenUpdate();
          break;
        case DatastreamAction.Alarm:
          this._panel?.postMessage({ type: 'alarm' });
          break;
        case DatastreamAction.KeyboardUnlock:
          this.keyboard.unlock();
          break;
      }
    }

    // WCC RESTORE_KB flag
    if (result.wcc & WCC.RESTORE_KB) {
      this.keyboard.unlock();
    }
  }

  /**
   * Process SSCP-LU data: raw EBCDIC text written at cursor position.
   * Used for VTAM/USS login screens in TN3270E mode.
   * No WCC or orders — just character data. Keyboard is unlocked after.
   */
  private processSscpLuData(data: Buffer): void {
    for (let i = 0; i < data.length; i++) {
      const byte = data[i];
      if (byte === 0x15) {
        // NL (New Line) — move cursor to start of next line
        const nextRow = this.screen.cursor.row + 1;
        if (nextRow < this.screen.rows) {
          this.screen.cursor.setPosition(nextRow * this.screen.cols);
        }
      } else {
        this.screen.setChar(this.screen.cursor.position, byte);
        this.screen.cursor.advance();
      }
    }
    this.keyboard.unlock();
    this.sendScreenUpdate();
  }

  // ── Webview message handling ─────────────────────────────────

  private handleWebviewMessage(msg: WebviewToHostMessage): void {
    if (msg.type === 'keyPress') {
      const mapped = mapKeyPress(msg as KeyPressMessage);
      if (!mapped) return;

      // SSCP-LU mode: handle input differently (no fields/AID)
      if (this._sscpLuMode) {
        this.handleSscpLuInput(mapped);
        return;
      }

      switch (mapped.type) {
        case 'aidKey':
          this.keyboard.handleAID(mapped.aid);
          break;
        case 'navigation':
          this.keyboard.handleNavigation(mapped.action);
          break;
        case 'charInput':
          this.keyboard.handleCharInput(mapped.char);
          break;
        case 'editAction':
          this.keyboard.handleEditAction(mapped.action);
          break;
        case 'reset':
          this.keyboard.handleReset();
          break;
      }
    }
  }

  /** Handle keyboard input in SSCP-LU mode (unformatted login screens). */
  private handleSscpLuInput(mapped: ReturnType<typeof mapKeyPress>): void {
    if (!mapped) return;

    if (mapped.type === 'charInput') {
      // Write EBCDIC char at cursor position
      const ebcdic = encodeChar(mapped.char);
      this.screen.setChar(this.screen.cursor.position, ebcdic);
      this.screen.cursor.advance();
      this.sendScreenUpdate();
    } else if (mapped.type === 'aidKey' && mapped.aid === 'Enter') {
      // Send the current line as SSCP-LU data
      this.sendSscpLuInput();
    } else if (mapped.type === 'navigation') {
      // Allow basic cursor navigation
      const cursor = this.screen.cursor;
      switch (mapped.action) {
        case 'left': cursor.moveLeft(); break;
        case 'right': cursor.moveRight(); break;
        case 'up': cursor.moveUp(); break;
        case 'down': cursor.moveDown(); break;
      }
      this.sendScreenUpdate();
    } else if (mapped.type === 'editAction') {
      if (mapped.action === 'backspace') {
        this.screen.cursor.retreat();
        this.screen.setChar(this.screen.cursor.position, 0x00);
        this.sendScreenUpdate();
      }
    }
  }

  /** Send the current cursor line as SSCP-LU data to the host. */
  private sendSscpLuInput(): void {
    // Collect non-null characters from the cursor's row
    const row = this.screen.cursor.row;
    const startPos = row * this.screen.cols;
    const chars: number[] = [];

    for (let col = 0; col < this.screen.cols; col++) {
      const ch = this.screen.getChar(startPos + col);
      if (ch !== 0x00) {
        chars.push(ch);
      }
    }

    // Strip trailing nulls (already done by the loop above)
    // Build TN3270E SSCP-LU response
    const header = buildHeader({
      dataType: TN3270EDataType.DATA_SSCP_LU,
      requestFlag: TN3270ERequestFlag.NO_RESPONSE,
      responseFlag: TN3270EResponseFlag.NO_RESPONSE,
      seqNumber: 0,
    });

    const data = Buffer.from(chars);
    const payload = Buffer.concat([header, data]);
    const eor = Buffer.from([0xFF, 0xEF]);
    this.connection.send(Buffer.concat([payload, eor]));

    // Lock keyboard until host responds
    this.keyboard.lock('X SYSTEM');
  }

  // ── Screen updates ──────────────────────────────────────────

  private sendScreenUpdate(): void {
    const codePage = getCodePage(this.profile.codePage);
    const msg = serializeScreen(this.screen, codePage);
    this._panel?.postMessage(msg);
  }

  private sendTheme(): void {
    this._panel?.postMessage(buildThemeMessage());
  }

  // ── Auto-reconnect ─────────────────────────────────────────

  private attemptReconnect(): void {
    if (!this.profile.autoReconnect) return;
    if (this._manualDisconnect) return;
    if (this._reconnectAttempts >= Session.MAX_RECONNECT_ATTEMPTS) return;

    this._reconnectAttempts++;
    const delay = Session.RECONNECT_BASE_DELAY * Math.pow(2, this._reconnectAttempts - 1);

    this._panel?.setTitle(`TN3270: ${this.profile.name} (Reconnecting...)`);

    this._reconnectTimer = setTimeout(() => {
      if (!this._disposed && !this._manualDisconnect) {
        this.connect();
      }
    }, delay);
  }

  private cancelReconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private updatePanelTitle(): void {
    const state = this.connection.state;
    let suffix = '';
    if (state === ConnectionState.Connecting) suffix = ' (Connecting...)';
    else if (state === ConnectionState.Disconnected) suffix = ' (Disconnected)';
    else if (state === ConnectionState.Error) suffix = ' (Error)';
    this._panel?.setTitle(`TN3270: ${this.profile.name}${suffix}`);
  }
}

// ── SessionManager ────────────────────────────────────────────────

export class SessionManager {
  private _sessions: Map<string, Session> = new Map();
  private _extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  /** Get all active sessions. */
  get sessions(): Session[] {
    return Array.from(this._sessions.values());
  }

  /** Get number of active sessions. */
  get count(): number {
    return this._sessions.size;
  }

  /** Create and start a new session from a profile. */
  createSession(profile: SessionProfile): Session {
    const session = new Session(profile, this._extensionUri);
    this._sessions.set(session.id, session);
    session.start();
    return session;
  }

  /** Get a session by ID. */
  getSession(id: string): Session | undefined {
    return this._sessions.get(id);
  }

  /** Disconnect and remove a session. */
  removeSession(id: string): void {
    const session = this._sessions.get(id);
    if (session) {
      session.dispose();
      this._sessions.delete(id);
    }
  }

  /** Disconnect all sessions and clean up. */
  disposeAll(): void {
    for (const session of this._sessions.values()) {
      session.dispose();
    }
    this._sessions.clear();
  }
}

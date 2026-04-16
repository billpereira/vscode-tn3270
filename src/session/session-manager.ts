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
import { getCodePage } from '../protocol/ebcdic';
import type { WebviewToHostMessage, KeyPressMessage } from '../webview/messages';

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

    this.connection.on('error', (_err: Error) => {
      // Error state is already communicated via stateChange
    });

    // Telnet negotiation responses → send to host
    this.telnet.on('send', (data: Buffer) => {
      this.connection.send(data);
    });

    this.telnet.on('negotiated', () => {
      // Negotiation complete — ready for 3270 datastream
    });

    // Telnet records → datastream processing
    this.telnet.on('record', (record: Buffer) => {
      this.processHostRecord(record);
    });

    // Keyboard → send response to host
    this.keyboard.on('send', (data: Buffer) => {
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
      if (!parsed) return;

      // Only process 3270 data records
      if (parsed.header.dataType !== TN3270EDataType.DATA_3270) {
        return;
      }
      payload = parsed.payload;
    }

    const result = processRecord(payload, this.screen);

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

  // ── Webview message handling ─────────────────────────────────

  private handleWebviewMessage(msg: WebviewToHostMessage): void {
    if (msg.type === 'keyPress') {
      const mapped = mapKeyPress(msg as KeyPressMessage);
      if (!mapped) return;

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

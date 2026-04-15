/**
 * TCP/TLS socket connection management.
 *
 * Wraps Node.js net.Socket / tls.TLSSocket with event-based lifecycle,
 * timeout handling, and reconnection support.
 */

import * as net from 'net';
import * as tls from 'tls';
import { EventEmitter } from 'events';

/** Connection configuration. */
export interface ConnectionConfig {
  host: string;
  port: number;
  tls: boolean;
  tlsVerify: boolean;
  /** Connection timeout in milliseconds. Default: 10000. */
  connectTimeout?: number;
}

/** Connection states. */
export enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Error = 'error',
}

/** Events emitted by Connection. */
export interface ConnectionEvents {
  stateChange: (state: ConnectionState) => void;
  data: (data: Buffer) => void;
  error: (err: Error) => void;
  close: () => void;
}

export class Connection extends EventEmitter {
  private _socket: net.Socket | tls.TLSSocket | null = null;
  private _state: ConnectionState = ConnectionState.Disconnected;
  private _config: ConnectionConfig | null = null;
  private _connectTimer: ReturnType<typeof setTimeout> | null = null;

  get state(): ConnectionState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === ConnectionState.Connected;
  }

  /** Connect to a TN3270 host. */
  connect(config: ConnectionConfig): void {
    if (this._socket) {
      this.disconnect();
    }

    this._config = config;
    this.setState(ConnectionState.Connecting);

    const timeout = config.connectTimeout ?? 10000;

    if (config.tls) {
      this._socket = tls.connect({
        host: config.host,
        port: config.port,
        rejectUnauthorized: config.tlsVerify,
      });

      (this._socket as tls.TLSSocket).once('secureConnect', () => {
        this.clearConnectTimer();
        this.setState(ConnectionState.Connected);
      });
    } else {
      this._socket = net.connect({
        host: config.host,
        port: config.port,
      });

      this._socket.once('connect', () => {
        this.clearConnectTimer();
        this.setState(ConnectionState.Connected);
      });
    }

    // Set connection timeout
    this._connectTimer = setTimeout(() => {
      if (this._state === ConnectionState.Connecting) {
        const err = new Error(`Connection timeout after ${timeout}ms`);
        this.handleError(err);
        this.disconnect();
      }
    }, timeout);

    this._socket.on('data', (data: Buffer) => {
      this.emit('data', data);
    });

    this._socket.on('error', (err: Error) => {
      this.handleError(err);
    });

    this._socket.on('close', () => {
      this.clearConnectTimer();
      this.setState(ConnectionState.Disconnected);
      this.emit('close');
    });

    // Disable Nagle's algorithm for responsive terminal interaction
    this._socket.setNoDelay(true);
  }

  /** Send data to the host. */
  send(data: Buffer): boolean {
    if (!this._socket || !this.isConnected) {
      return false;
    }
    return this._socket.write(data);
  }

  /** Disconnect from the host. */
  disconnect(): void {
    this.clearConnectTimer();
    if (this._socket) {
      this._socket.removeAllListeners();
      this._socket.destroy();
      this._socket = null;
    }
    this.setState(ConnectionState.Disconnected);
  }

  /** Reconnect using the last configuration. */
  reconnect(): void {
    if (!this._config) {
      throw new Error('No previous connection configuration');
    }
    this.disconnect();
    this.connect(this._config);
  }

  /** Dispose of all resources. */
  dispose(): void {
    this.disconnect();
    this.removeAllListeners();
  }

  private setState(state: ConnectionState): void {
    if (this._state !== state) {
      this._state = state;
      this.emit('stateChange', state);
    }
  }

  private handleError(err: Error): void {
    this.setState(ConnectionState.Error);
    this.emit('error', err);
  }

  private clearConnectTimer(): void {
    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }
  }
}

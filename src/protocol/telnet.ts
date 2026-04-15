/**
 * Telnet option negotiation for TN3270 per RFC 1576.
 *
 * Handles IAC command parsing, TERMINAL-TYPE, BINARY, and EOR option
 * negotiation. Outputs negotiation responses and extracts 3270 datastream
 * records delimited by IAC EOR.
 */

import { EventEmitter } from 'events';

// ── Telnet constants ────────────────────────────────────────────────

/** Telnet command bytes. */
export const TelnetCommand = {
  IAC:  0xFF,
  DONT: 0xFE,
  DO:   0xFD,
  WONT: 0xFC,
  WILL: 0xFB,
  SB:   0xFA, // Sub-negotiation Begin
  SE:   0xF0, // Sub-negotiation End
  EOR:  0xEF, // End of Record
} as const;

/** Telnet option codes relevant to TN3270. */
export const TelnetOption = {
  BINARY:        0x00,
  TERMINAL_TYPE: 0x18,
  EOR:           0x19,
  TN3270E:       0x28,
} as const;

/** Sub-negotiation commands for TERMINAL-TYPE. */
export const TerminalTypeSub = {
  IS:   0x00,
  SEND: 0x01,
} as const;

// ── Types ───────────────────────────────────────────────────────────

/** Negotiation state for a single option. */
interface OptionState {
  local: boolean;  // WILL/WONT (our side)
  remote: boolean; // DO/DONT (their side)
}

/** Events emitted by TelnetNegotiator. */
export interface TelnetEvents {
  /** A complete 3270 datastream record (between EOR markers). */
  record: (data: Buffer) => void;
  /** Raw bytes to send back to the host. */
  send: (data: Buffer) => void;
  /** Negotiation is complete — all required options agreed. */
  negotiated: () => void;
  /** An error during negotiation. */
  error: (err: Error) => void;
}

// ── Parser states ───────────────────────────────────────────────────

enum ParseState {
  Data,
  IAC,
  Command,
  SubNeg,
  SubNegIAC,
}

// ── TelnetNegotiator ────────────────────────────────────────────────

export class TelnetNegotiator extends EventEmitter {
  private _terminalType: string;
  private _parseState: ParseState = ParseState.Data;
  private _currentCommand: number = 0;
  private _subNegBuffer: number[] = [];
  private _recordBuffer: number[] = [];

  /** Option negotiation state. */
  private _options: Map<number, OptionState> = new Map();

  /** Whether negotiation is complete. */
  private _negotiated: boolean = false;

  constructor(terminalType: string = 'IBM-3279-2-E') {
    super();
    this._terminalType = terminalType;
  }

  get terminalType(): string {
    return this._terminalType;
  }

  get isNegotiated(): boolean {
    return this._negotiated;
  }

  /** Process incoming bytes from the socket. */
  processData(data: Buffer): void {
    for (let i = 0; i < data.length; i++) {
      this.processByte(data[i]);
    }
  }

  /** Get or create option state. */
  private getOption(option: number): OptionState {
    let state = this._options.get(option);
    if (!state) {
      state = { local: false, remote: false };
      this._options.set(option, state);
    }
    return state;
  }

  /** Process a single byte through the state machine. */
  private processByte(byte: number): void {
    switch (this._parseState) {
      case ParseState.Data:
        if (byte === TelnetCommand.IAC) {
          this._parseState = ParseState.IAC;
        } else {
          this._recordBuffer.push(byte);
        }
        break;

      case ParseState.IAC:
        switch (byte) {
          case TelnetCommand.IAC:
            // Escaped IAC → literal 0xFF in data
            this._recordBuffer.push(0xFF);
            this._parseState = ParseState.Data;
            break;
          case TelnetCommand.DO:
          case TelnetCommand.DONT:
          case TelnetCommand.WILL:
          case TelnetCommand.WONT:
            this._currentCommand = byte;
            this._parseState = ParseState.Command;
            break;
          case TelnetCommand.SB:
            this._subNegBuffer = [];
            this._parseState = ParseState.SubNeg;
            break;
          case TelnetCommand.EOR:
            this.handleEOR();
            this._parseState = ParseState.Data;
            break;
          default:
            // Other IAC commands — ignore
            this._parseState = ParseState.Data;
            break;
        }
        break;

      case ParseState.Command:
        this.handleCommand(this._currentCommand, byte);
        this._parseState = ParseState.Data;
        break;

      case ParseState.SubNeg:
        if (byte === TelnetCommand.IAC) {
          this._parseState = ParseState.SubNegIAC;
        } else {
          this._subNegBuffer.push(byte);
        }
        break;

      case ParseState.SubNegIAC:
        if (byte === TelnetCommand.SE) {
          this.handleSubNegotiation();
          this._parseState = ParseState.Data;
        } else if (byte === TelnetCommand.IAC) {
          // Escaped IAC in sub-negotiation
          this._subNegBuffer.push(0xFF);
          this._parseState = ParseState.SubNeg;
        } else {
          // Unexpected — treat as end of sub-negotiation
          this._parseState = ParseState.Data;
        }
        break;
    }
  }

  /** Handle DO/DONT/WILL/WONT commands. */
  private handleCommand(command: number, option: number): void {
    const state = this.getOption(option);

    switch (command) {
      case TelnetCommand.DO:
        // Host asks us to enable an option
        if (this.shouldAcceptDo(option)) {
          if (!state.local) {
            state.local = true;
            this.sendCommand(TelnetCommand.WILL, option);
          }
        } else {
          this.sendCommand(TelnetCommand.WONT, option);
        }
        break;

      case TelnetCommand.DONT:
        state.local = false;
        this.sendCommand(TelnetCommand.WONT, option);
        break;

      case TelnetCommand.WILL:
        // Host offers to enable an option
        if (this.shouldAcceptWill(option)) {
          if (!state.remote) {
            state.remote = true;
            this.sendCommand(TelnetCommand.DO, option);
          }
        } else {
          this.sendCommand(TelnetCommand.DONT, option);
        }
        break;

      case TelnetCommand.WONT:
        state.remote = false;
        this.sendCommand(TelnetCommand.DONT, option);
        break;
    }

    this.checkNegotiationComplete();
  }

  /** Determine if we should accept a DO request for the given option. */
  private shouldAcceptDo(option: number): boolean {
    return (
      option === TelnetOption.BINARY ||
      option === TelnetOption.TERMINAL_TYPE ||
      option === TelnetOption.EOR ||
      option === TelnetOption.TN3270E
    );
  }

  /** Determine if we should accept a WILL offer for the given option. */
  private shouldAcceptWill(option: number): boolean {
    return (
      option === TelnetOption.BINARY ||
      option === TelnetOption.EOR
    );
  }

  /** Handle sub-negotiation data. */
  private handleSubNegotiation(): void {
    if (this._subNegBuffer.length === 0) return;

    const option = this._subNegBuffer[0];

    if (option === TelnetOption.TERMINAL_TYPE) {
      this.handleTerminalTypeSubNeg();
    }
    // TN3270E sub-negotiation handled in tn3270e.ts
  }

  /** Handle TERMINAL-TYPE sub-negotiation. */
  private handleTerminalTypeSubNeg(): void {
    if (this._subNegBuffer.length < 2) return;

    const subCommand = this._subNegBuffer[1];
    if (subCommand === TerminalTypeSub.SEND) {
      // Host asks for our terminal type — respond with IS
      this.sendTerminalType();
    }
  }

  /** Send TERMINAL-TYPE IS response. */
  private sendTerminalType(): void {
    const typeBytes = Buffer.from(this._terminalType, 'ascii');
    const response = Buffer.alloc(typeBytes.length + 6);
    let i = 0;
    response[i++] = TelnetCommand.IAC;
    response[i++] = TelnetCommand.SB;
    response[i++] = TelnetOption.TERMINAL_TYPE;
    response[i++] = TerminalTypeSub.IS;
    typeBytes.copy(response, i);
    i += typeBytes.length;
    response[i++] = TelnetCommand.IAC;
    response[i++] = TelnetCommand.SE;

    this.emit('send', response);
  }

  /** Handle End of Record marker. */
  private handleEOR(): void {
    if (this._recordBuffer.length > 0) {
      this.emit('record', Buffer.from(this._recordBuffer));
      this._recordBuffer = [];
    }
  }

  /** Send a telnet command (IAC + command + option). */
  private sendCommand(command: number, option: number): void {
    this.emit('send', Buffer.from([TelnetCommand.IAC, command, option]));
  }

  /** Check if all required options are negotiated. */
  private checkNegotiationComplete(): void {
    if (this._negotiated) return;

    const binary = this.getOption(TelnetOption.BINARY);
    const eor = this.getOption(TelnetOption.EOR);
    const tt = this.getOption(TelnetOption.TERMINAL_TYPE);

    if (binary.local && eor.local && tt.local) {
      this._negotiated = true;
      this.emit('negotiated');
    }
  }

  /** Get the raw sub-negotiation buffer (for TN3270E extension). */
  getSubNegBuffer(): number[] {
    return [...this._subNegBuffer];
  }
}

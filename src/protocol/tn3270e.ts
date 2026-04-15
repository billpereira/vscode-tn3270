/**
 * TN3270E protocol negotiation and header parsing per RFC 2355.
 *
 * TN3270E extends basic TN3270 with:
 * - Device-type and LU name negotiation
 * - Function negotiation (BIND-IMAGE, DATA-ASSOCIATE, RESPONSES, SCS-CTL-CODES)
 * - 5-byte headers on every data record
 * - Explicit response handling
 */

// ── TN3270E constants ───────────────────────────────────────────────

/** TN3270E sub-negotiation commands. */
export const TN3270ESub = {
  SEND:       0x08,
  IS:         0x04,
  DEVICE_TYPE: 0x02,
  FUNCTIONS:  0x03,
  REQUEST:    0x07,
  REASON:     0x05,
} as const;

/** TN3270E function codes. */
export const TN3270EFunction = {
  BIND_IMAGE:      0x00,
  DATA_ASSOCIATE:  0x01,
  RESPONSES:       0x02,
  SCS_CTL_CODES:   0x03,
} as const;

/** TN3270E data type codes in the header. */
export const TN3270EDataType = {
  DATA_3270:     0x00,
  DATA_SCS:      0x01,
  DATA_RESPONSE: 0x02,
  DATA_BIND:     0x03,
  DATA_UNBIND:   0x04,
  DATA_NVT:      0x05,
  DATA_REQUEST:  0x06,
  DATA_SSCP_LU:  0x07,
} as const;

/** TN3270E request flags. */
export const TN3270ERequestFlag = {
  NO_RESPONSE:     0x00,
  ERROR_RESPONSE:  0x01,
  ALWAYS_RESPONSE: 0x02,
} as const;

/** TN3270E response flags. */
export const TN3270EResponseFlag = {
  NO_RESPONSE:     0x00,
  POSITIVE:        0x00,
  NEGATIVE:        0x01,
} as const;

/** Reason codes for DEVICE-TYPE REJECT. */
export const TN3270EReason = {
  CONN_PARTNER:    0x00,
  DEVICE_IN_USE:   0x01,
  INV_ASSOCIATE:   0x02,
  INV_NAME:        0x03,
  INV_DEVICE_TYPE: 0x04,
  TYPE_NAME_ERROR: 0x05,
  UNKNOWN_ERROR:   0x06,
  UNSUPPORTED_REQ: 0x07,
} as const;

// ── TN3270E header ──────────────────────────────────────────────────

/** Parsed TN3270E 5-byte header. */
export interface TN3270EHeader {
  dataType: number;
  requestFlag: number;
  responseFlag: number;
  seqNumber: number; // 16-bit sequence number
}

/**
 * Parse a TN3270E 5-byte header from the start of a record.
 */
export function parseHeader(data: Buffer): TN3270EHeader | null {
  if (data.length < 5) return null;
  return {
    dataType: data[0],
    requestFlag: data[1],
    responseFlag: data[2],
    seqNumber: (data[3] << 8) | data[4],
  };
}

/**
 * Build a TN3270E 5-byte header.
 */
export function buildHeader(header: TN3270EHeader): Buffer {
  return Buffer.from([
    header.dataType,
    header.requestFlag,
    header.responseFlag,
    (header.seqNumber >> 8) & 0xFF,
    header.seqNumber & 0xFF,
  ]);
}

/**
 * Strip the TN3270E header from a record and return header + payload.
 */
export function stripHeader(record: Buffer): { header: TN3270EHeader; payload: Buffer } | null {
  const header = parseHeader(record);
  if (!header) return null;
  return { header, payload: record.slice(5) };
}

// ── TN3270E negotiation state machine ───────────────────────────────

export enum TN3270ENegState {
  None,
  DeviceTypeSent,
  DeviceTypeAccepted,
  FunctionsSent,
  Complete,
  Failed,
}

/** Result of TN3270E negotiation. */
export interface TN3270ENegResult {
  state: TN3270ENegState;
  deviceType: string;
  luName: string;
  functions: number[];
}

export class TN3270ENegotiator {
  private _state: TN3270ENegState = TN3270ENegState.None;
  private _deviceType: string;
  private _luName: string;
  private _requestedFunctions: number[];
  private _agreedFunctions: number[] = [];

  constructor(
    deviceType: string = 'IBM-3279-2-E',
    luName: string = '',
    functions: number[] = [
      TN3270EFunction.BIND_IMAGE,
      TN3270EFunction.RESPONSES,
      TN3270EFunction.SCS_CTL_CODES,
    ],
  ) {
    this._deviceType = deviceType;
    this._luName = luName;
    this._requestedFunctions = functions;
  }

  get state(): TN3270ENegState { return this._state; }
  get deviceType(): string { return this._deviceType; }
  get luName(): string { return this._luName; }
  get agreedFunctions(): number[] { return [...this._agreedFunctions]; }
  get isTN3270E(): boolean { return this._state === TN3270ENegState.Complete; }

  /**
   * Build the initial DEVICE-TYPE REQUEST sub-negotiation.
   * Sent after the host sends DO TN3270E and we respond WILL TN3270E.
   *
   * Format: IAC SB TN3270E DEVICE-TYPE REQUEST <device-type> [CONNECT <lu-name>] IAC SE
   */
  buildDeviceTypeRequest(): Buffer {
    const parts: number[] = [
      0xFF, 0xFA, 0x28, // IAC SB TN3270E
      TN3270ESub.DEVICE_TYPE,
      TN3270ESub.REQUEST,
    ];

    // Add device type as ASCII bytes
    for (let i = 0; i < this._deviceType.length; i++) {
      parts.push(this._deviceType.charCodeAt(i));
    }

    // If LU name specified, add CONNECT <lu-name>
    if (this._luName) {
      parts.push(0x01); // CONNECT byte
      for (let i = 0; i < this._luName.length; i++) {
        parts.push(this._luName.charCodeAt(i));
      }
    }

    parts.push(0xFF, 0xF0); // IAC SE
    this._state = TN3270ENegState.DeviceTypeSent;
    return Buffer.from(parts);
  }

  /**
   * Build the FUNCTIONS REQUEST sub-negotiation.
   *
   * Format: IAC SB TN3270E FUNCTIONS REQUEST <function-list> IAC SE
   */
  buildFunctionsRequest(): Buffer {
    const parts: number[] = [
      0xFF, 0xFA, 0x28, // IAC SB TN3270E
      TN3270ESub.FUNCTIONS,
      TN3270ESub.REQUEST,
      ...this._requestedFunctions,
      0xFF, 0xF0, // IAC SE
    ];
    this._state = TN3270ENegState.FunctionsSent;
    return Buffer.from(parts);
  }

  /**
   * Process a TN3270E sub-negotiation response from the host.
   * Returns the next message to send (or null if done/failed).
   *
   * @param subNegData The bytes between SB and SE (without IAC SB / IAC SE).
   */
  processSubNeg(subNegData: number[]): Buffer | null {
    if (subNegData.length < 2 || subNegData[0] !== 0x28) return null;

    const subCommand = subNegData[1];

    switch (subCommand) {
      case TN3270ESub.DEVICE_TYPE:
        return this.handleDeviceTypeResponse(subNegData);

      case TN3270ESub.FUNCTIONS:
        return this.handleFunctionsResponse(subNegData);

      default:
        return null;
    }
  }

  private handleDeviceTypeResponse(data: number[]): Buffer | null {
    if (data.length < 3) return null;

    const action = data[2];

    if (action === TN3270ESub.IS) {
      // Host accepted: DEVICE-TYPE IS <type> CONNECT <lu>
      this._state = TN3270ENegState.DeviceTypeAccepted;

      // Parse the assigned device type and LU name
      const remaining = data.slice(3);
      const connectIdx = remaining.indexOf(0x01); // CONNECT separator

      if (connectIdx >= 0) {
        this._deviceType = String.fromCharCode(...remaining.slice(0, connectIdx));
        this._luName = String.fromCharCode(...remaining.slice(connectIdx + 1));
      } else {
        this._deviceType = String.fromCharCode(...remaining);
      }

      // Now send FUNCTIONS REQUEST
      return this.buildFunctionsRequest();
    }

    if (action === TN3270ESub.REASON) {
      // Host rejected
      this._state = TN3270ENegState.Failed;
      return null;
    }

    return null;
  }

  private handleFunctionsResponse(data: number[]): Buffer | null {
    if (data.length < 3) return null;

    const action = data[2];

    if (action === TN3270ESub.IS) {
      // Host accepted: FUNCTIONS IS <function-list>
      this._agreedFunctions = data.slice(3);
      this._state = TN3270ENegState.Complete;
      return null; // negotiation complete
    }

    if (action === TN3270ESub.REQUEST) {
      // Host counter-proposed: FUNCTIONS REQUEST <function-list>
      // Accept what the host proposed
      this._agreedFunctions = data.slice(3);
      this._state = TN3270ENegState.Complete;

      // Respond with FUNCTIONS IS <agreed-list>
      const parts: number[] = [
        0xFF, 0xFA, 0x28,
        TN3270ESub.FUNCTIONS,
        TN3270ESub.IS,
        ...this._agreedFunctions,
        0xFF, 0xF0,
      ];
      return Buffer.from(parts);
    }

    return null;
  }
}

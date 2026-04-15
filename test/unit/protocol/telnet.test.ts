import {
  TelnetNegotiator, TelnetCommand, TelnetOption, TerminalTypeSub,
} from '../../../src/protocol/telnet';

/** Helper to build IAC command sequences. */
function iac(command: number, option: number): Buffer {
  return Buffer.from([TelnetCommand.IAC, command, option]);
}

/** Helper to build sub-negotiation sequences. */
function subNeg(option: number, ...data: number[]): Buffer {
  return Buffer.from([
    TelnetCommand.IAC, TelnetCommand.SB,
    option, ...data,
    TelnetCommand.IAC, TelnetCommand.SE,
  ]);
}

describe('TelnetNegotiator', () => {
  let negotiator: TelnetNegotiator;
  let sent: Buffer[];

  beforeEach(() => {
    negotiator = new TelnetNegotiator('IBM-3279-2-E');
    sent = [];
    negotiator.on('send', (data: Buffer) => sent.push(data));
  });

  it('should initialize with the correct terminal type', () => {
    expect(negotiator.terminalType).toBe('IBM-3279-2-E');
    expect(negotiator.isNegotiated).toBe(false);
  });

  describe('DO handling', () => {
    it('should respond WILL to DO BINARY', () => {
      negotiator.processData(iac(TelnetCommand.DO, TelnetOption.BINARY));
      expect(sent.length).toBe(1);
      expect(sent[0]).toEqual(iac(TelnetCommand.WILL, TelnetOption.BINARY));
    });

    it('should respond WILL to DO TERMINAL-TYPE', () => {
      negotiator.processData(iac(TelnetCommand.DO, TelnetOption.TERMINAL_TYPE));
      expect(sent.length).toBe(1);
      expect(sent[0]).toEqual(iac(TelnetCommand.WILL, TelnetOption.TERMINAL_TYPE));
    });

    it('should respond WILL to DO EOR', () => {
      negotiator.processData(iac(TelnetCommand.DO, TelnetOption.EOR));
      expect(sent.length).toBe(1);
      expect(sent[0]).toEqual(iac(TelnetCommand.WILL, TelnetOption.EOR));
    });

    it('should respond WONT to unsupported DO options', () => {
      negotiator.processData(iac(TelnetCommand.DO, 0x99)); // unknown
      expect(sent.length).toBe(1);
      expect(sent[0]).toEqual(iac(TelnetCommand.WONT, 0x99));
    });

    it('should not send duplicate WILL for repeated DO', () => {
      negotiator.processData(iac(TelnetCommand.DO, TelnetOption.BINARY));
      negotiator.processData(iac(TelnetCommand.DO, TelnetOption.BINARY));
      expect(sent.length).toBe(1);
    });
  });

  describe('WILL handling', () => {
    it('should respond DO to WILL BINARY', () => {
      negotiator.processData(iac(TelnetCommand.WILL, TelnetOption.BINARY));
      expect(sent.length).toBe(1);
      expect(sent[0]).toEqual(iac(TelnetCommand.DO, TelnetOption.BINARY));
    });

    it('should respond DO to WILL EOR', () => {
      negotiator.processData(iac(TelnetCommand.WILL, TelnetOption.EOR));
      expect(sent.length).toBe(1);
      expect(sent[0]).toEqual(iac(TelnetCommand.DO, TelnetOption.EOR));
    });

    it('should respond DONT to unsupported WILL options', () => {
      negotiator.processData(iac(TelnetCommand.WILL, 0x99));
      expect(sent.length).toBe(1);
      expect(sent[0]).toEqual(iac(TelnetCommand.DONT, 0x99));
    });
  });

  describe('DONT / WONT handling', () => {
    it('should respond WONT to DONT', () => {
      negotiator.processData(iac(TelnetCommand.DONT, TelnetOption.BINARY));
      expect(sent.length).toBe(1);
      expect(sent[0]).toEqual(iac(TelnetCommand.WONT, TelnetOption.BINARY));
    });

    it('should respond DONT to WONT', () => {
      negotiator.processData(iac(TelnetCommand.WONT, TelnetOption.EOR));
      expect(sent.length).toBe(1);
      expect(sent[0]).toEqual(iac(TelnetCommand.DONT, TelnetOption.EOR));
    });
  });

  describe('TERMINAL-TYPE sub-negotiation', () => {
    it('should send terminal type when asked', () => {
      // First accept DO TERMINAL-TYPE
      negotiator.processData(iac(TelnetCommand.DO, TelnetOption.TERMINAL_TYPE));
      sent = []; // clear

      // Host sends SB TERMINAL-TYPE SEND
      negotiator.processData(subNeg(TelnetOption.TERMINAL_TYPE, TerminalTypeSub.SEND));

      expect(sent.length).toBe(1);
      const response = sent[0];

      // Should be: IAC SB TERMINAL-TYPE IS IBM-3279-2-E IAC SE
      expect(response[0]).toBe(TelnetCommand.IAC);
      expect(response[1]).toBe(TelnetCommand.SB);
      expect(response[2]).toBe(TelnetOption.TERMINAL_TYPE);
      expect(response[3]).toBe(TerminalTypeSub.IS);
      const typeStr = response.slice(4, response.length - 2).toString('ascii');
      expect(typeStr).toBe('IBM-3279-2-E');
      expect(response[response.length - 2]).toBe(TelnetCommand.IAC);
      expect(response[response.length - 1]).toBe(TelnetCommand.SE);
    });
  });

  describe('EOR record handling', () => {
    it('should emit records delimited by IAC EOR', () => {
      const records: Buffer[] = [];
      negotiator.on('record', (data: Buffer) => records.push(data));

      // Complete negotiation first so data flows
      const dataWithEOR = Buffer.from([
        0xF5, 0xC3, // some 3270 data
        TelnetCommand.IAC, TelnetCommand.EOR,
      ]);
      negotiator.processData(dataWithEOR);

      expect(records.length).toBe(1);
      expect(records[0]).toEqual(Buffer.from([0xF5, 0xC3]));
    });

    it('should handle escaped IAC (0xFF 0xFF) in data', () => {
      const records: Buffer[] = [];
      negotiator.on('record', (data: Buffer) => records.push(data));

      const data = Buffer.from([
        0x01, TelnetCommand.IAC, TelnetCommand.IAC, 0x02,
        TelnetCommand.IAC, TelnetCommand.EOR,
      ]);
      negotiator.processData(data);

      expect(records.length).toBe(1);
      expect(records[0]).toEqual(Buffer.from([0x01, 0xFF, 0x02]));
    });

    it('should handle multiple records in one chunk', () => {
      const records: Buffer[] = [];
      negotiator.on('record', (data: Buffer) => records.push(data));

      const data = Buffer.from([
        0xAA, 0xBB,
        TelnetCommand.IAC, TelnetCommand.EOR,
        0xCC, 0xDD,
        TelnetCommand.IAC, TelnetCommand.EOR,
      ]);
      negotiator.processData(data);

      expect(records.length).toBe(2);
      expect(records[0]).toEqual(Buffer.from([0xAA, 0xBB]));
      expect(records[1]).toEqual(Buffer.from([0xCC, 0xDD]));
    });

    it('should handle records split across multiple processData calls', () => {
      const records: Buffer[] = [];
      negotiator.on('record', (data: Buffer) => records.push(data));

      negotiator.processData(Buffer.from([0xAA, 0xBB]));
      negotiator.processData(Buffer.from([0xCC, TelnetCommand.IAC]));
      negotiator.processData(Buffer.from([TelnetCommand.EOR]));

      expect(records.length).toBe(1);
      expect(records[0]).toEqual(Buffer.from([0xAA, 0xBB, 0xCC]));
    });
  });

  describe('negotiation completion', () => {
    it('should emit negotiated when BINARY, EOR, and TERMINAL-TYPE are agreed', (done) => {
      negotiator.on('negotiated', () => {
        expect(negotiator.isNegotiated).toBe(true);
        done();
      });

      negotiator.processData(iac(TelnetCommand.DO, TelnetOption.BINARY));
      negotiator.processData(iac(TelnetCommand.DO, TelnetOption.EOR));
      negotiator.processData(iac(TelnetCommand.DO, TelnetOption.TERMINAL_TYPE));
    });

    it('should not emit negotiated until all required options are agreed', () => {
      let negotiated = false;
      negotiator.on('negotiated', () => { negotiated = true; });

      negotiator.processData(iac(TelnetCommand.DO, TelnetOption.BINARY));
      negotiator.processData(iac(TelnetCommand.DO, TelnetOption.EOR));
      // TERMINAL-TYPE not yet agreed
      expect(negotiated).toBe(false);
    });

    it('should only emit negotiated once', () => {
      let count = 0;
      negotiator.on('negotiated', () => { count++; });

      negotiator.processData(iac(TelnetCommand.DO, TelnetOption.BINARY));
      negotiator.processData(iac(TelnetCommand.DO, TelnetOption.EOR));
      negotiator.processData(iac(TelnetCommand.DO, TelnetOption.TERMINAL_TYPE));
      // Repeat
      negotiator.processData(iac(TelnetCommand.DO, TelnetOption.BINARY));
      expect(count).toBe(1);
    });
  });

  describe('full negotiation sequence', () => {
    it('should handle a typical z/OS negotiation flow', () => {
      const records: Buffer[] = [];
      negotiator.on('record', (data: Buffer) => records.push(data));

      // Typical z/OS sends all DOs at once
      const hostInit = Buffer.concat([
        iac(TelnetCommand.DO, TelnetOption.TERMINAL_TYPE),
        iac(TelnetCommand.WILL, TelnetOption.BINARY),
        iac(TelnetCommand.DO, TelnetOption.BINARY),
        iac(TelnetCommand.WILL, TelnetOption.EOR),
        iac(TelnetCommand.DO, TelnetOption.EOR),
      ]);
      negotiator.processData(hostInit);

      // We should have sent WILL/DO responses
      expect(sent.length).toBe(5);

      // Then host asks for terminal type
      negotiator.processData(subNeg(TelnetOption.TERMINAL_TYPE, TerminalTypeSub.SEND));

      // Then host sends first screen
      const screenData = Buffer.from([
        0xF5, 0xC3, 0x11, 0x40, 0x40, // EW + WCC + SBA
        TelnetCommand.IAC, TelnetCommand.EOR,
      ]);
      negotiator.processData(screenData);

      expect(records.length).toBe(1);
      expect(negotiator.isNegotiated).toBe(true);
    });
  });

  describe('mixed data and commands', () => {
    it('should handle commands interleaved with data', () => {
      const records: Buffer[] = [];
      negotiator.on('record', (data: Buffer) => records.push(data));

      // Data, then a DO command, then more data + EOR
      const chunk = Buffer.from([
        0xAA,
        TelnetCommand.IAC, TelnetCommand.DO, TelnetOption.BINARY,
        0xBB,
        TelnetCommand.IAC, TelnetCommand.EOR,
      ]);
      negotiator.processData(chunk);

      expect(records.length).toBe(1);
      expect(records[0]).toEqual(Buffer.from([0xAA, 0xBB]));
    });
  });
});

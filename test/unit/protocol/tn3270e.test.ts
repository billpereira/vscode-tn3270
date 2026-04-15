import {
  TN3270ENegotiator, TN3270ENegState, TN3270EFunction, TN3270ESub,
  parseHeader, buildHeader, stripHeader,
  TN3270EDataType, TN3270ERequestFlag, TN3270EResponseFlag,
} from '../../../src/protocol/tn3270e';

describe('TN3270E header', () => {
  describe('parseHeader', () => {
    it('should parse a 5-byte header', () => {
      const data = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x01]);
      const header = parseHeader(data);
      expect(header).toEqual({
        dataType: TN3270EDataType.DATA_3270,
        requestFlag: TN3270ERequestFlag.NO_RESPONSE,
        responseFlag: TN3270EResponseFlag.NO_RESPONSE,
        seqNumber: 1,
      });
    });

    it('should parse 16-bit sequence number correctly', () => {
      const data = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00]);
      const header = parseHeader(data);
      expect(header?.seqNumber).toBe(256);
    });

    it('should return null for short buffers', () => {
      expect(parseHeader(Buffer.from([0x00, 0x00]))).toBeNull();
    });
  });

  describe('buildHeader', () => {
    it('should build a 5-byte header', () => {
      const header = buildHeader({
        dataType: TN3270EDataType.DATA_3270,
        requestFlag: TN3270ERequestFlag.ERROR_RESPONSE,
        responseFlag: TN3270EResponseFlag.NO_RESPONSE,
        seqNumber: 42,
      });
      expect(header).toEqual(Buffer.from([0x00, 0x01, 0x00, 0x00, 0x2A]));
    });

    it('should round-trip through parse', () => {
      const original = {
        dataType: TN3270EDataType.DATA_RESPONSE,
        requestFlag: TN3270ERequestFlag.ALWAYS_RESPONSE,
        responseFlag: TN3270EResponseFlag.POSITIVE,
        seqNumber: 1000,
      };
      const buf = buildHeader(original);
      expect(parseHeader(buf)).toEqual(original);
    });
  });

  describe('stripHeader', () => {
    it('should separate header from payload', () => {
      const record = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x01, 0xF5, 0xC3]);
      const result = stripHeader(record);
      expect(result).not.toBeNull();
      expect(result!.header.seqNumber).toBe(1);
      expect(result!.payload).toEqual(Buffer.from([0xF5, 0xC3]));
    });

    it('should return null for short records', () => {
      expect(stripHeader(Buffer.from([0x00]))).toBeNull();
    });

    it('should handle header-only records (empty payload)', () => {
      const record = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
      const result = stripHeader(record);
      expect(result!.payload.length).toBe(0);
    });
  });
});

describe('TN3270ENegotiator', () => {
  let negotiator: TN3270ENegotiator;

  beforeEach(() => {
    negotiator = new TN3270ENegotiator('IBM-3279-2-E', '', [
      TN3270EFunction.BIND_IMAGE,
      TN3270EFunction.RESPONSES,
    ]);
  });

  it('should start in None state', () => {
    expect(negotiator.state).toBe(TN3270ENegState.None);
    expect(negotiator.isTN3270E).toBe(false);
  });

  describe('buildDeviceTypeRequest', () => {
    it('should build a valid DEVICE-TYPE REQUEST', () => {
      const req = negotiator.buildDeviceTypeRequest();
      // IAC SB TN3270E DEVICE-TYPE REQUEST <type> IAC SE
      expect(req[0]).toBe(0xFF); // IAC
      expect(req[1]).toBe(0xFA); // SB
      expect(req[2]).toBe(0x28); // TN3270E
      expect(req[3]).toBe(TN3270ESub.DEVICE_TYPE);
      expect(req[4]).toBe(TN3270ESub.REQUEST);
      const typeStr = req.slice(5, req.length - 2).toString('ascii');
      expect(typeStr).toBe('IBM-3279-2-E');
      expect(req[req.length - 2]).toBe(0xFF); // IAC
      expect(req[req.length - 1]).toBe(0xF0); // SE
      expect(negotiator.state).toBe(TN3270ENegState.DeviceTypeSent);
    });

    it('should include LU name with CONNECT separator', () => {
      const neg = new TN3270ENegotiator('IBM-3279-2-E', 'LU001');
      const req = neg.buildDeviceTypeRequest();
      // Find CONNECT byte (0x01)
      const bytes = Array.from(req);
      const connectIdx = bytes.indexOf(0x01, 5);
      expect(connectIdx).toBeGreaterThan(5);
      const luStr = req.slice(connectIdx + 1, req.length - 2).toString('ascii');
      expect(luStr).toBe('LU001');
    });
  });

  describe('DEVICE-TYPE IS response', () => {
    it('should handle accepted device type and send FUNCTIONS REQUEST', () => {
      negotiator.buildDeviceTypeRequest(); // move to DeviceTypeSent

      // Host responds: TN3270E DEVICE-TYPE IS IBM-3279-2-E CONNECT LU002
      const typeBytes = [...Buffer.from('IBM-3279-2-E', 'ascii')];
      const luBytes = [...Buffer.from('LU002', 'ascii')];
      const subNeg = [0x28, TN3270ESub.DEVICE_TYPE, TN3270ESub.IS, ...typeBytes, 0x01, ...luBytes];

      const response = negotiator.processSubNeg(subNeg);
      expect(negotiator.state).toBe(TN3270ENegState.FunctionsSent);
      expect(negotiator.luName).toBe('LU002');
      expect(response).not.toBeNull();
      // Response should be FUNCTIONS REQUEST
      expect(response![3]).toBe(TN3270ESub.FUNCTIONS);
      expect(response![4]).toBe(TN3270ESub.REQUEST);
    });

    it('should handle accepted device type without LU name', () => {
      negotiator.buildDeviceTypeRequest();
      const typeBytes = [...Buffer.from('IBM-3279-2-E', 'ascii')];
      const subNeg = [0x28, TN3270ESub.DEVICE_TYPE, TN3270ESub.IS, ...typeBytes];

      negotiator.processSubNeg(subNeg);
      expect(negotiator.deviceType).toBe('IBM-3279-2-E');
      expect(negotiator.state).toBe(TN3270ENegState.FunctionsSent);
    });
  });

  describe('DEVICE-TYPE REJECT', () => {
    it('should handle rejected device type', () => {
      negotiator.buildDeviceTypeRequest();
      const subNeg = [0x28, TN3270ESub.DEVICE_TYPE, TN3270ESub.REASON, 0x04];

      const response = negotiator.processSubNeg(subNeg);
      expect(response).toBeNull();
      expect(negotiator.state).toBe(TN3270ENegState.Failed);
    });
  });

  describe('FUNCTIONS negotiation', () => {
    beforeEach(() => {
      negotiator.buildDeviceTypeRequest();
      const typeBytes = [...Buffer.from('IBM-3279-2-E', 'ascii')];
      negotiator.processSubNeg([0x28, TN3270ESub.DEVICE_TYPE, TN3270ESub.IS, ...typeBytes]);
      // Now in FunctionsSent state
    });

    it('should complete when host accepts functions with IS', () => {
      const subNeg = [0x28, TN3270ESub.FUNCTIONS, TN3270ESub.IS,
        TN3270EFunction.BIND_IMAGE, TN3270EFunction.RESPONSES];

      const response = negotiator.processSubNeg(subNeg);
      expect(response).toBeNull(); // no more messages needed
      expect(negotiator.state).toBe(TN3270ENegState.Complete);
      expect(negotiator.isTN3270E).toBe(true);
      expect(negotiator.agreedFunctions).toEqual([
        TN3270EFunction.BIND_IMAGE,
        TN3270EFunction.RESPONSES,
      ]);
    });

    it('should accept host counter-proposal and respond with IS', () => {
      // Host counter-proposes with just BIND-IMAGE
      const subNeg = [0x28, TN3270ESub.FUNCTIONS, TN3270ESub.REQUEST,
        TN3270EFunction.BIND_IMAGE];

      const response = negotiator.processSubNeg(subNeg);
      expect(response).not.toBeNull();
      expect(negotiator.state).toBe(TN3270ENegState.Complete);
      expect(negotiator.agreedFunctions).toEqual([TN3270EFunction.BIND_IMAGE]);
      // Response should be FUNCTIONS IS with accepted functions
      expect(response![4]).toBe(TN3270ESub.IS);
    });
  });

  describe('full negotiation flow', () => {
    it('should complete a typical TN3270E negotiation', () => {
      // 1. Client sends DEVICE-TYPE REQUEST
      const devReq = negotiator.buildDeviceTypeRequest();
      expect(devReq).toBeTruthy();

      // 2. Host responds DEVICE-TYPE IS
      const typeBytes = [...Buffer.from('IBM-3279-2-E', 'ascii')];
      const luBytes = [...Buffer.from('TSO0001', 'ascii')];
      const funcReq = negotiator.processSubNeg(
        [0x28, TN3270ESub.DEVICE_TYPE, TN3270ESub.IS, ...typeBytes, 0x01, ...luBytes]
      );
      expect(funcReq).toBeTruthy(); // should get FUNCTIONS REQUEST

      // 3. Host responds FUNCTIONS IS
      negotiator.processSubNeg([
        0x28, TN3270ESub.FUNCTIONS, TN3270ESub.IS,
        TN3270EFunction.BIND_IMAGE, TN3270EFunction.RESPONSES,
      ]);

      expect(negotiator.isTN3270E).toBe(true);
      expect(negotiator.deviceType).toBe('IBM-3279-2-E');
      expect(negotiator.luName).toBe('TSO0001');
      expect(negotiator.agreedFunctions).toContain(TN3270EFunction.BIND_IMAGE);
      expect(negotiator.agreedFunctions).toContain(TN3270EFunction.RESPONSES);
    });
  });

  describe('edge cases', () => {
    it('should return null for empty sub-negotiation', () => {
      expect(negotiator.processSubNeg([])).toBeNull();
    });

    it('should return null for non-TN3270E sub-negotiation', () => {
      expect(negotiator.processSubNeg([0x18, 0x01])).toBeNull();
    });

    it('should return null for short sub-negotiation', () => {
      expect(negotiator.processSubNeg([0x28])).toBeNull();
    });
  });
});

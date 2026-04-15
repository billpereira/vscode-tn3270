/**
 * Tests for session profile — pure functions (normalizeProfile, validateProfile).
 * The CRUD functions depend on vscode.workspace which can't be tested in unit tests.
 */

jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn(() => []),
      update: jest.fn(),
    })),
  },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
}), { virtual: true });

import {
  normalizeProfile,
  validateProfile,
  DEFAULT_PROFILE,
  type SessionProfile,
} from '../../../src/session/session-profile';

describe('normalizeProfile', () => {
  it('should fill in all defaults for empty input', () => {
    const result = normalizeProfile({});
    expect(result.name).toBe('');
    expect(result.host).toBe('');
    expect(result.port).toBe(23);
    expect(result.model).toBe('IBM-3279-2-E');
    expect(result.tls).toBe(false);
    expect(result.tlsVerify).toBe(true);
    expect(result.luName).toBe('');
    expect(result.codePage).toBe('CP037');
    expect(result.autoReconnect).toBe(false);
  });

  it('should preserve provided values', () => {
    const result = normalizeProfile({
      name: 'Test',
      host: 'mainframe.local',
      port: 992,
      tls: true,
      autoReconnect: true,
    });
    expect(result.name).toBe('Test');
    expect(result.host).toBe('mainframe.local');
    expect(result.port).toBe(992);
    expect(result.tls).toBe(true);
    expect(result.autoReconnect).toBe(true);
    expect(result.model).toBe('IBM-3279-2-E'); // default
  });

  it('should produce a complete SessionProfile', () => {
    const result = normalizeProfile({ name: 'A', host: 'B' });
    const keys = Object.keys(result);
    expect(keys).toContain('name');
    expect(keys).toContain('host');
    expect(keys).toContain('port');
    expect(keys).toContain('model');
    expect(keys).toContain('tls');
    expect(keys).toContain('tlsVerify');
    expect(keys).toContain('luName');
    expect(keys).toContain('codePage');
    expect(keys).toContain('autoReconnect');
  });
});

describe('validateProfile', () => {
  it('should return no errors for valid profile', () => {
    const errors = validateProfile({ name: 'Test', host: 'host.com', port: 23 });
    expect(errors).toEqual([]);
  });

  it('should require name', () => {
    const errors = validateProfile({ host: 'host.com' });
    expect(errors).toContain('Profile name is required');
  });

  it('should require host', () => {
    const errors = validateProfile({ name: 'Test' });
    expect(errors).toContain('Host is required');
  });

  it('should reject empty name', () => {
    const errors = validateProfile({ name: '  ', host: 'h' });
    expect(errors).toContain('Profile name is required');
  });

  it('should reject port 0', () => {
    const errors = validateProfile({ name: 'T', host: 'h', port: 0 });
    expect(errors).toContain('Port must be between 1 and 65535');
  });

  it('should reject port > 65535', () => {
    const errors = validateProfile({ name: 'T', host: 'h', port: 99999 });
    expect(errors).toContain('Port must be between 1 and 65535');
  });

  it('should allow valid ports', () => {
    expect(validateProfile({ name: 'T', host: 'h', port: 1 })).toEqual([]);
    expect(validateProfile({ name: 'T', host: 'h', port: 65535 })).toEqual([]);
    expect(validateProfile({ name: 'T', host: 'h', port: 23 })).toEqual([]);
  });

  it('should return multiple errors at once', () => {
    const errors = validateProfile({ port: 0 });
    expect(errors.length).toBe(3); // name, host, port
  });
});

describe('DEFAULT_PROFILE', () => {
  it('should have expected default values', () => {
    expect(DEFAULT_PROFILE.port).toBe(23);
    expect(DEFAULT_PROFILE.model).toBe('IBM-3279-2-E');
    expect(DEFAULT_PROFILE.tls).toBe(false);
    expect(DEFAULT_PROFILE.codePage).toBe('CP037');
  });
});

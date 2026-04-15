/**
 * Tests for secret storage — uses an in-memory mock of vscode.SecretStorage.
 */

jest.mock('vscode', () => ({}), { virtual: true });

import {
  storageKey,
  storePassword,
  getPassword,
  deletePassword,
  hasPassword,
} from '../../../src/session/secret-storage';

/** In-memory mock of vscode.SecretStorage. */
function createMockSecretStorage() {
  const store = new Map<string, string>();
  return {
    get: jest.fn(async (key: string) => store.get(key)),
    store: jest.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: jest.fn(async (key: string) => { store.delete(key); }),
    onDidChange: jest.fn(),
  };
}

describe('storageKey', () => {
  it('should prefix profile name', () => {
    expect(storageKey('MyHost')).toBe('tn3270.password.MyHost');
  });

  it('should handle special characters', () => {
    expect(storageKey('host:23')).toBe('tn3270.password.host:23');
  });
});

describe('storePassword / getPassword', () => {
  it('should store and retrieve a password', async () => {
    const secrets = createMockSecretStorage();
    await storePassword(secrets as any, 'prod', 's3cret');
    const result = await getPassword(secrets as any, 'prod');
    expect(result).toBe('s3cret');
  });

  it('should return undefined for unknown profile', async () => {
    const secrets = createMockSecretStorage();
    const result = await getPassword(secrets as any, 'nonexistent');
    expect(result).toBeUndefined();
  });

  it('should overwrite existing password', async () => {
    const secrets = createMockSecretStorage();
    await storePassword(secrets as any, 'prod', 'old');
    await storePassword(secrets as any, 'prod', 'new');
    const result = await getPassword(secrets as any, 'prod');
    expect(result).toBe('new');
  });
});

describe('deletePassword', () => {
  it('should delete a stored password', async () => {
    const secrets = createMockSecretStorage();
    await storePassword(secrets as any, 'prod', 'pw');
    await deletePassword(secrets as any, 'prod');
    const result = await getPassword(secrets as any, 'prod');
    expect(result).toBeUndefined();
  });

  it('should not error when deleting non-existent password', async () => {
    const secrets = createMockSecretStorage();
    await expect(deletePassword(secrets as any, 'none')).resolves.not.toThrow();
  });
});

describe('hasPassword', () => {
  it('should return true when password exists', async () => {
    const secrets = createMockSecretStorage();
    await storePassword(secrets as any, 'prod', 'pw');
    expect(await hasPassword(secrets as any, 'prod')).toBe(true);
  });

  it('should return false when password does not exist', async () => {
    const secrets = createMockSecretStorage();
    expect(await hasPassword(secrets as any, 'prod')).toBe(false);
  });
});

/**
 * Secure credential storage via VS Code SecretStorage API.
 *
 * Passwords are stored in the OS keychain (macOS Keychain, Windows
 * Credential Manager, GNOME Keyring / KDE Wallet on Linux) and
 * never written to settings.json.
 */

import * as vscode from 'vscode';

const KEY_PREFIX = 'tn3270.password.';

/** Get the storage key for a profile name. */
export function storageKey(profileName: string): string {
  return `${KEY_PREFIX}${profileName}`;
}

/** Store a password for a profile. */
export async function storePassword(
  secrets: vscode.SecretStorage,
  profileName: string,
  password: string,
): Promise<void> {
  await secrets.store(storageKey(profileName), password);
}

/** Retrieve a stored password for a profile. */
export async function getPassword(
  secrets: vscode.SecretStorage,
  profileName: string,
): Promise<string | undefined> {
  return secrets.get(storageKey(profileName));
}

/** Delete a stored password for a profile. */
export async function deletePassword(
  secrets: vscode.SecretStorage,
  profileName: string,
): Promise<void> {
  await secrets.delete(storageKey(profileName));
}

/** Check if a password is stored for a profile. */
export async function hasPassword(
  secrets: vscode.SecretStorage,
  profileName: string,
): Promise<boolean> {
  const pw = await secrets.get(storageKey(profileName));
  return pw !== undefined;
}

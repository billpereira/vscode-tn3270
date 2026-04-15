/**
 * Session profile management.
 *
 * Profiles are stored in the `tn3270.profiles` VS Code setting.
 * Provides CRUD operations and a typed interface for profile data.
 */

import * as vscode from 'vscode';

// ── Profile types ─────────────────────────────────────────────────

export interface SessionProfile {
  name: string;
  host: string;
  port: number;
  model: string;
  tls: boolean;
  tlsVerify: boolean;
  luName: string;
  codePage: string;
  autoReconnect: boolean;
}

/** Default values for a new profile. */
export const DEFAULT_PROFILE: Readonly<Omit<SessionProfile, 'name' | 'host'>> = {
  port: 23,
  model: 'IBM-3279-2-E',
  tls: false,
  tlsVerify: true,
  luName: '',
  codePage: 'CP037',
  autoReconnect: false,
};

// ── CRUD operations ───────────────────────────────────────────────

const SETTING_KEY = 'tn3270.profiles';

/** Read all profiles from VS Code settings. */
export function getProfiles(): SessionProfile[] {
  const config = vscode.workspace.getConfiguration();
  const raw = config.get<SessionProfile[]>(SETTING_KEY, []);
  return raw.map(normalizeProfile);
}

/** Get a single profile by name. */
export function getProfileByName(name: string): SessionProfile | undefined {
  return getProfiles().find(p => p.name === name);
}

/** Save a profile (creates or updates by name). */
export async function saveProfile(
  profile: SessionProfile,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Promise<void> {
  const profiles = getProfiles();
  const idx = profiles.findIndex(p => p.name === profile.name);
  if (idx >= 0) {
    profiles[idx] = profile;
  } else {
    profiles.push(profile);
  }
  await vscode.workspace.getConfiguration().update(SETTING_KEY, profiles, target);
}

/** Delete a profile by name. */
export async function deleteProfile(
  name: string,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Promise<boolean> {
  const profiles = getProfiles();
  const idx = profiles.findIndex(p => p.name === name);
  if (idx < 0) return false;
  profiles.splice(idx, 1);
  await vscode.workspace.getConfiguration().update(SETTING_KEY, profiles, target);
  return true;
}

/** Get profile names for Quick Pick display. */
export function getProfileNames(): string[] {
  return getProfiles().map(p => p.name);
}

// ── Pure helpers (testable without vscode) ────────────────────────

/** Normalize a profile by filling in defaults for missing fields. */
export function normalizeProfile(raw: Partial<SessionProfile>): SessionProfile {
  return {
    name: raw.name ?? '',
    host: raw.host ?? '',
    port: raw.port ?? DEFAULT_PROFILE.port,
    model: raw.model ?? DEFAULT_PROFILE.model,
    tls: raw.tls ?? DEFAULT_PROFILE.tls,
    tlsVerify: raw.tlsVerify ?? DEFAULT_PROFILE.tlsVerify,
    luName: raw.luName ?? DEFAULT_PROFILE.luName,
    codePage: raw.codePage ?? DEFAULT_PROFILE.codePage,
    autoReconnect: raw.autoReconnect ?? DEFAULT_PROFILE.autoReconnect,
  };
}

/** Validate that a profile has the required fields. Returns error messages. */
export function validateProfile(profile: Partial<SessionProfile>): string[] {
  const errors: string[] = [];
  if (!profile.name?.trim()) errors.push('Profile name is required');
  if (!profile.host?.trim()) errors.push('Host is required');
  if (profile.port !== undefined && (profile.port < 1 || profile.port > 65535)) {
    errors.push('Port must be between 1 and 65535');
  }
  return errors;
}

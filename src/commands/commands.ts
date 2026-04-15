/**
 * VS Code command registrations.
 *
 * Registers the TN3270 commands:
 * - openSession: Show profile picker, then open a session
 * - manageProfiles: Create/edit/delete session profiles
 * - disconnect: Disconnect the active session
 */

import * as vscode from 'vscode';
import { SessionManager } from '../session/session-manager';
import {
  getProfiles,
  saveProfile,
  deleteProfile,
  normalizeProfile,
  type SessionProfile,
} from '../session/session-profile';
import { deletePassword } from '../session/secret-storage';

/** Register all TN3270 commands. Returns disposables to add to context.subscriptions. */
export function registerCommands(
  context: vscode.ExtensionContext,
  sessionManager: SessionManager,
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.commands.registerCommand('vscode-tn3270.openSession', async () => {
      await openSessionCommand(context, sessionManager);
    }),
  );

  disposables.push(
    vscode.commands.registerCommand('vscode-tn3270.manageProfiles', async () => {
      await manageProfilesCommand(context);
    }),
  );

  disposables.push(
    vscode.commands.registerCommand('vscode-tn3270.disconnect', async () => {
      await disconnectCommand(sessionManager);
    }),
  );

  return disposables;
}

// ── Open Session ──────────────────────────────────────────────────

async function openSessionCommand(
  context: vscode.ExtensionContext,
  sessionManager: SessionManager,
): Promise<void> {
  const profiles = getProfiles();
  if (profiles.length === 0) {
    const action = await vscode.window.showInformationMessage(
      'No TN3270 profiles configured. Create one now?',
      'Create Profile',
      'Cancel',
    );
    if (action === 'Create Profile') {
      const profile = await createProfileWizard();
      if (profile) {
        await saveProfile(profile);
        sessionManager.createSession(profile);
      }
    }
    return;
  }

  const names = profiles.map(p => ({
    label: p.name,
    description: `${p.host}:${p.port}${p.tls ? ' (TLS)' : ''}`,
  }));
  names.push({ label: '$(add) Create New Profile...', description: '' });

  const picked = await vscode.window.showQuickPick(names, {
    placeHolder: 'Select a session profile',
  });

  if (!picked) return;

  if (picked.label.includes('Create New Profile')) {
    const profile = await createProfileWizard();
    if (profile) {
      await saveProfile(profile);
      sessionManager.createSession(profile);
    }
    return;
  }

  const profile = profiles.find(p => p.name === picked.label);
  if (profile) {
    sessionManager.createSession(profile);
  }
}

// ── Manage Profiles ───────────────────────────────────────────────

async function manageProfilesCommand(
  context: vscode.ExtensionContext,
): Promise<void> {
  const profiles = getProfiles();
  const items: vscode.QuickPickItem[] = profiles.map(p => ({
    label: p.name,
    description: `${p.host}:${p.port}`,
  }));
  items.push({ label: '$(add) Create New Profile', description: '' });

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a profile to edit, or create a new one',
  });

  if (!picked) return;

  if (picked.label.includes('Create New Profile')) {
    const profile = await createProfileWizard();
    if (profile) {
      await saveProfile(profile);
      vscode.window.showInformationMessage(`Profile "${profile.name}" created.`);
    }
    return;
  }

  // Edit/delete an existing profile
  const profile = profiles.find(p => p.name === picked.label);
  if (!profile) return;

  const action = await vscode.window.showQuickPick(
    ['Edit', 'Delete', 'Cancel'],
    { placeHolder: `What do you want to do with "${profile.name}"?` },
  );

  if (action === 'Edit') {
    const edited = await editProfileWizard(profile);
    if (edited) {
      await saveProfile(edited);
      vscode.window.showInformationMessage(`Profile "${edited.name}" updated.`);
    }
  } else if (action === 'Delete') {
    const confirm = await vscode.window.showWarningMessage(
      `Delete profile "${profile.name}"?`,
      { modal: true },
      'Delete',
    );
    if (confirm === 'Delete') {
      await deleteProfile(profile.name);
      await deletePassword(context.secrets, profile.name);
      vscode.window.showInformationMessage(`Profile "${profile.name}" deleted.`);
    }
  }
}

// ── Disconnect ────────────────────────────────────────────────────

async function disconnectCommand(sessionManager: SessionManager): Promise<void> {
  const sessions = sessionManager.sessions.filter(s => s.isConnected);
  if (sessions.length === 0) {
    vscode.window.showInformationMessage('No active TN3270 sessions.');
    return;
  }

  if (sessions.length === 1) {
    sessions[0].disconnect();
    vscode.window.showInformationMessage(
      `Disconnected "${sessions[0].profile.name}".`,
    );
    return;
  }

  const items = sessions.map(s => ({
    label: s.profile.name,
    description: `${s.profile.host}:${s.profile.port}`,
    sessionId: s.id,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a session to disconnect',
  });

  if (picked) {
    const session = sessionManager.getSession(picked.sessionId);
    session?.disconnect();
    vscode.window.showInformationMessage(`Disconnected "${picked.label}".`);
  }
}

// ── Profile wizards ───────────────────────────────────────────────

async function createProfileWizard(): Promise<SessionProfile | null> {
  const name = await vscode.window.showInputBox({
    prompt: 'Profile name',
    placeHolder: 'My Mainframe',
    validateInput: v => v.trim() ? null : 'Name is required',
  });
  if (!name) return null;

  const host = await vscode.window.showInputBox({
    prompt: 'Hostname or IP address',
    placeHolder: 'mainframe.example.com',
    validateInput: v => v.trim() ? null : 'Host is required',
  });
  if (!host) return null;

  const portStr = await vscode.window.showInputBox({
    prompt: 'Port number',
    value: '23',
    validateInput: v => {
      const n = parseInt(v, 10);
      return (n >= 1 && n <= 65535) ? null : 'Port must be 1-65535';
    },
  });
  if (!portStr) return null;

  const tls = await vscode.window.showQuickPick(['No', 'Yes'], {
    placeHolder: 'Use TLS encryption?',
  });
  if (!tls) return null;

  return normalizeProfile({
    name: name.trim(),
    host: host.trim(),
    port: parseInt(portStr, 10),
    tls: tls === 'Yes',
  });
}

async function editProfileWizard(
  existing: SessionProfile,
): Promise<SessionProfile | null> {
  const host = await vscode.window.showInputBox({
    prompt: 'Hostname or IP address',
    value: existing.host,
    validateInput: v => v.trim() ? null : 'Host is required',
  });
  if (!host) return null;

  const portStr = await vscode.window.showInputBox({
    prompt: 'Port number',
    value: String(existing.port),
    validateInput: v => {
      const n = parseInt(v, 10);
      return (n >= 1 && n <= 65535) ? null : 'Port must be 1-65535';
    },
  });
  if (!portStr) return null;

  const tls = await vscode.window.showQuickPick(['No', 'Yes'], {
    placeHolder: 'Use TLS encryption?',
  });
  if (!tls) return null;

  return {
    ...existing,
    host: host.trim(),
    port: parseInt(portStr, 10),
    tls: tls === 'Yes',
  };
}

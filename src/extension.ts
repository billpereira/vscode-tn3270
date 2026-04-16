/**
 * Extension entry point.
 *
 * Activates on command invocation, initializes the SessionManager,
 * registers commands, and listens for theme changes.
 */

import * as vscode from 'vscode';
import { SessionManager } from './session/session-manager';
import { registerCommands } from './commands/commands';
import { dispose as disposeLogger } from './session/logger';


let sessionManager: SessionManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  sessionManager = new SessionManager(context.extensionUri);

  // Register commands
  const commandDisposables = registerCommands(context, sessionManager);
  context.subscriptions.push(...commandDisposables);

  // Theme changes are handled by individual session panels via VS Code CSS variables

  // Clean up on deactivation
  context.subscriptions.push({
    dispose: () => {
      sessionManager?.disposeAll();
    },
  });
}

export function deactivate() {
  sessionManager?.disposeAll();
  sessionManager = undefined;
  disposeLogger();
}

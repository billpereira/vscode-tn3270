/**
 * Debug logger for TN3270 sessions.
 *
 * Writes to a VS Code Output Channel ("TN3270 Debug") so users can
 * diagnose connection and protocol issues from the Output panel.
 */

import * as vscode from 'vscode';

let _channel: vscode.OutputChannel | null = null;

/** Get or create the shared output channel. */
function getChannel(): vscode.OutputChannel {
  if (!_channel) {
    _channel = vscode.window.createOutputChannel('TN3270 Debug');
  }
  return _channel;
}

/** Log a debug message with timestamp and category. */
export function log(category: string, message: string): void {
  const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  getChannel().appendLine(`[${ts}] [${category}] ${message}`);
}

/** Log a hex dump of a buffer (first N bytes). */
export function logHex(category: string, label: string, data: Buffer, maxBytes: number = 32): void {
  const hex = data.slice(0, Math.min(maxBytes, data.length)).toString('hex');
  const suffix = data.length > maxBytes ? `... (${data.length} bytes total)` : ` (${data.length} bytes)`;
  log(category, `${label}: ${hex}${suffix}`);
}

/** Show the output channel (bring it to focus). */
export function show(): void {
  getChannel().show(true);
}

/** Dispose the output channel. */
export function dispose(): void {
  _channel?.dispose();
  _channel = null;
}

/**
 * Manages the lifecycle of TN3270 Webview panels.
 *
 * Creates WebviewPanels, sets up postMessage communication, handles
 * panel disposal, and provides methods to send messages to the webview.
 */

import * as vscode from 'vscode';
import type { HostToWebviewMessage, WebviewToHostMessage } from './messages';

export class PanelManager {
  private _panel: vscode.WebviewPanel | null = null;
  private _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _onMessage: (message: WebviewToHostMessage) => void;
  private _onDispose: () => void;

  constructor(
    extensionUri: vscode.Uri,
    onMessage: (message: WebviewToHostMessage) => void,
    onDispose: () => void,
  ) {
    this._extensionUri = extensionUri;
    this._onMessage = onMessage;
    this._onDispose = onDispose;
  }

  get isVisible(): boolean {
    return this._panel?.visible ?? false;
  }

  /** Create and show the webview panel. */
  createPanel(sessionName: string): vscode.WebviewPanel {
    if (this._panel) {
      this._panel.reveal();
      return this._panel;
    }

    this._panel = vscode.window.createWebviewPanel(
      'tn3270Terminal',
      `TN3270: ${sessionName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this._extensionUri, 'media'),
          vscode.Uri.joinPath(this._extensionUri, 'out', 'webview'),
        ],
      },
    );

    this._panel.webview.html = this.getHtmlContent(this._panel.webview);

    // Listen for messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (message: WebviewToHostMessage) => {
        this._onMessage(message);
      },
      null,
      this._disposables,
    );

    // Handle panel disposal
    this._panel.onDidDispose(
      () => {
        this._panel = null;
        this._onDispose();
        this.disposeAll();
      },
      null,
      this._disposables,
    );

    return this._panel;
  }

  /** Send a message to the webview. */
  postMessage(message: HostToWebviewMessage): void {
    this._panel?.webview.postMessage(message);
  }

  /** Update the panel title. */
  setTitle(title: string): void {
    if (this._panel) {
      this._panel.title = title;
    }
  }

  /** Dispose the panel and clean up. */
  dispose(): void {
    this._panel?.dispose();
  }

  private disposeAll(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }

  /** Generate the HTML content for the webview. */
  private getHtmlContent(webview: vscode.Webview): string {
    const nonce = getNonce();

    // Font URIs
    const fontRegularWoff = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'fonts', '3270-Regular.woff'),
    );
    const fontRegularTtf = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'fonts', '3270-Regular.ttf'),
    );
    const fontSemiCondensedWoff = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'fonts', '3270SemiCondensed-Regular.woff'),
    );

    const cspSource = webview.cspSource;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${cspSource};">
  <title>TN3270</title>
  <style>
    @font-face {
      font-family: '3270';
      src: url('${fontRegularWoff}') format('woff'),
           url('${fontRegularTtf}') format('truetype');
      font-weight: normal;
      font-style: normal;
      font-display: block;
    }
    @font-face {
      font-family: '3270 SemiCondensed';
      src: url('${fontSemiCondensedWoff}') format('woff');
      font-weight: normal;
      font-style: normal;
      font-display: block;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      overflow: hidden;
      background: var(--vscode-editor-background, #1e1e1e);
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    #terminal-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #terminal-canvas {
      image-rendering: pixelated;
    }
    #oia-bar {
      height: 20px;
      padding: 0 8px;
      font-family: '3270', monospace;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--vscode-statusBar-background, #007acc);
      color: var(--vscode-statusBar-foreground, #ffffff);
    }
    #oia-bar .oia-left, #oia-bar .oia-right {
      display: flex;
      gap: 12px;
    }
  </style>
</head>
<body>
  <div id="terminal-container">
    <canvas id="terminal-canvas"></canvas>
  </div>
  <div id="oia-bar">
    <div class="oia-left">
      <span id="oia-status">Disconnected</span>
      <span id="oia-lock"></span>
    </div>
    <div class="oia-right">
      <span id="oia-insert"></span>
      <span id="oia-cursor">00/000</span>
      <span id="oia-model"></span>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Message handler from extension host
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'screenUpdate':
          handleScreenUpdate(message);
          break;
        case 'connectionState':
          handleConnectionState(message);
          break;
        case 'keyboardState':
          handleKeyboardState(message);
          break;
        case 'oiaUpdate':
          handleOIAUpdate(message);
          break;
        case 'alarm':
          handleAlarm();
          break;
        case 'theme':
          handleTheme(message);
          break;
      }
    });

    // Keyboard capture
    document.addEventListener('keydown', event => {
      event.preventDefault();
      vscode.postMessage({
        type: 'keyPress',
        key: event.key,
        shift: event.shiftKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
      });
    });

    // Canvas and rendering state
    const canvas = document.getElementById('terminal-canvas');
    const ctx = canvas.getContext('2d');
    let cellWidth = 9;
    let cellHeight = 18;
    let screenRows = 24;
    let screenCols = 80;
    let currentCells = [];
    let cursorPosition = { row: 0, col: 0 };
    let cursorVisible = true;
    let themeColors = {
      background: '#000000',
      foreground: '#33ff33',
      cursor: '#33ff33',
      blue: '#5555ff', red: '#ff5555', pink: '#ff55ff',
      green: '#33ff33', turquoise: '#55ffff', yellow: '#ffff55',
      white: '#ffffff',
      oiaBackground: '#007acc', oiaForeground: '#ffffff',
    };

    // Cursor blink
    setInterval(() => {
      cursorVisible = !cursorVisible;
      renderCursor();
    }, 530);

    function handleScreenUpdate(msg) {
      screenRows = msg.rows;
      screenCols = msg.cols;
      currentCells = msg.cells;
      cursorPosition = { row: msg.cursorRow, col: msg.cursorCol };
      resizeCanvas();
      renderScreen();
    }

    function handleConnectionState(msg) {
      document.getElementById('oia-status').textContent =
        msg.state.charAt(0).toUpperCase() + msg.state.slice(1);
    }

    function handleKeyboardState(msg) {
      document.getElementById('oia-lock').textContent = msg.locked ? msg.reason : '';
    }

    function handleOIAUpdate(msg) {
      document.getElementById('oia-status').textContent = msg.connected ? 'Connected' : 'Disconnected';
      document.getElementById('oia-cursor').textContent =
        String(msg.cursorRow + 1).padStart(2, '0') + '/' +
        String(msg.cursorCol + 1).padStart(3, '0');
      document.getElementById('oia-insert').textContent = msg.insertMode ? 'INS' : '';
      document.getElementById('oia-model').textContent = msg.terminalModel;
      document.getElementById('oia-lock').textContent = msg.keyboardLocked ? msg.lockReason : '';
    }

    function handleAlarm() {
      // Simple audio beep
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = 800;
        gain.gain.value = 0.1;
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
      } catch (e) { /* ignore audio errors */ }
    }

    function handleTheme(msg) {
      themeColors = msg.colors;
      document.body.style.background = themeColors.background;
      const oia = document.getElementById('oia-bar');
      oia.style.background = themeColors.oiaBackground;
      oia.style.color = themeColors.oiaForeground;
      renderScreen();
    }

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const width = screenCols * cellWidth;
      const height = screenRows * cellHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      ctx.scale(dpr, dpr);
    }

    function renderScreen() {
      if (!currentCells.length) return;
      ctx.fillStyle = themeColors.background;
      ctx.fillRect(0, 0, screenCols * cellWidth, screenRows * cellHeight);
      ctx.font = cellHeight + 'px "3270", monospace';
      ctx.textBaseline = 'top';

      for (let i = 0; i < currentCells.length; i++) {
        const cell = currentCells[i];
        const row = Math.floor(i / screenCols);
        const col = i % screenCols;
        const x = col * cellWidth;
        const y = row * cellHeight;

        if (cell.isFieldAttribute) continue; // attribute bytes are blank

        // Determine color
        const fg = resolveColor(cell.extended.foreground, themeColors.foreground);
        const bg = resolveColor(cell.extended.background, themeColors.background);

        // Background
        if (bg !== themeColors.background) {
          ctx.fillStyle = bg;
          ctx.fillRect(x, y, cellWidth, cellHeight);
        }

        // Reverse video
        if (cell.extended.highlight === 0xF2) {
          ctx.fillStyle = fg;
          ctx.fillRect(x, y, cellWidth, cellHeight);
          ctx.fillStyle = bg === themeColors.background ? themeColors.background : bg;
        } else {
          ctx.fillStyle = fg;
        }

        // Character
        if (cell.char && cell.char !== '\\u0000') {
          ctx.fillText(cell.char, x, y);
        }

        // Underscore highlight
        if (cell.extended.highlight === 0xF4) {
          ctx.fillStyle = fg;
          ctx.fillRect(x, y + cellHeight - 2, cellWidth, 1);
        }
      }

      renderCursor();
    }

    function renderCursor() {
      if (!currentCells.length) return;
      const x = cursorPosition.col * cellWidth;
      const y = cursorPosition.row * cellHeight;

      // Redraw the cell under cursor first
      const idx = cursorPosition.row * screenCols + cursorPosition.col;
      if (idx < currentCells.length) {
        const cell = currentCells[idx];
        const bg = resolveColor(cell.extended.background, themeColors.background);
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, cellWidth, cellHeight);
        ctx.fillStyle = resolveColor(cell.extended.foreground, themeColors.foreground);
        ctx.font = cellHeight + 'px "3270", monospace';
        ctx.textBaseline = 'top';
        if (cell.char && cell.char !== '\\u0000') {
          ctx.fillText(cell.char, x, y);
        }
      }

      // Draw cursor
      if (cursorVisible) {
        ctx.fillStyle = themeColors.cursor;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(x, y + cellHeight - 3, cellWidth, 3);
        ctx.globalAlpha = 1.0;
      }
    }

    function resolveColor(colorCode, defaultColor) {
      switch (colorCode) {
        case 0xF1: return themeColors.blue;
        case 0xF2: return themeColors.red;
        case 0xF3: return themeColors.pink;
        case 0xF4: return themeColors.green;
        case 0xF5: return themeColors.turquoise;
        case 0xF6: return themeColors.yellow;
        case 0xF7: return themeColors.white;
        default: return defaultColor;
      }
    }

    // Initial canvas setup
    resizeCanvas();
  </script>
</body>
</html>`;
  }
}

/** Generate a random nonce for CSP. */
function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

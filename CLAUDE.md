# CLAUDE.md

## Project Overview
vscode-tn3270 is a VS Code extension providing a native TN3270/TN3270E terminal emulator. It follows a three-tier architecture: Webview (renderer) ↔ Extension Host (protocol/session) ↔ TCP/TLS socket.

## Architecture
- `src/protocol/` — Telnet negotiation, TN3270E, 3270 datastream parsing, EBCDIC codecs
- `src/emulator/` — Screen buffer model, field attributes, cursor, terminal model definitions
- `src/session/` — Session lifecycle, profile CRUD, TCP/TLS connection management
- `src/webview/` — Canvas/DOM renderer, keyboard handler, theme integration (runs in sandboxed iframe)
- `src/commands/` — VS Code command palette registrations
- `webview-ui/` — Webview frontend assets
- `test/` — Jest tests (unit + integration)

## Key Design Decisions
- No xterm.js — 3270 is block-mode, not stream-mode; a purpose-built renderer is required
- All TCP/TLS I/O happens in the Extension Host (Node.js); Webview communicates via postMessage
- Passwords stored via VS Code SecretStorage API, never in settings JSON
- Primary reference: zowe/tn3270-ng2 (three-tier WebSocket model maps to our postMessage model)

## Commands
- `npm run compile` — Build TypeScript
- `npm run watch` — Watch mode
- `npm run lint` — ESLint
- `npm test` — Jest tests

## Code Style
- TypeScript strict mode
- ESLint with @typescript-eslint

# vscode-tn3270

[![CI](https://github.com/billpereira/vscode-tn3270/actions/workflows/ci.yml/badge.svg)](https://github.com/billpereira/vscode-tn3270/actions/workflows/ci.yml)

A native TN3270/TN3270E terminal emulator for Visual Studio Code. Connect to IBM z/OS, CICS, TSO, and ISPF directly from your editor.

## Screenshots

> Screenshots will be added once the Webview renderer is complete.

<!-- ![TSO Login Screen](media/screenshots/tso-login.png) -->
<!-- ![ISPF Panel](media/screenshots/ispf-panel.png) -->

## Features

- **Native TN3270/TN3270E** — Full protocol support with TLS 1.2/1.3
- **Multiple concurrent sessions** — Each session in its own VS Code tab
- **Faithful 3270 emulation** — Field attributes, extended colors, highlighting
- **Multiple terminal models** — IBM-3278-2 through IBM-3279-5-E (24×80 to 27×132)
- **Theme integration** — Adapts to VS Code light/dark/high-contrast themes
- **Configurable keyboard** — Standard 3270 key mappings via VS Code keybindings
- **Session profiles** — Workspace or user-scoped, with secure credential storage

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Run `TN3270: Manage Session Profiles` to create a connection profile
4. Run `TN3270: Open Session` to connect

## Requirements

- VS Code 1.85.0 or later
- Network access to a TN3270-compatible host (z/OS, Hercules, etc.)

## Architecture

```
┌─────────────────────────────────────────────────┐
│  VS Code Webview (sandboxed iframe)             │
│  ┌───────────────────────────────────────────┐  │
│  │  Canvas/DOM Renderer  ←→  Keyboard Handler│  │
│  └──────────────────┬────────────────────────┘  │
│                     │ postMessage                │
├─────────────────────┼───────────────────────────┤
│  Extension Host     │ (Node.js)                 │
│  ┌──────────────────┴────────────────────────┐  │
│  │  Session Manager  ←→  3270 Datastream     │  │
│  │  TN3270E Negotiation  ←→  EBCDIC Codec   │  │
│  └──────────────────┬────────────────────────┘  │
│                     │ net.Socket / tls.TLSSocket │
├─────────────────────┼───────────────────────────┤
│  z/OS / Hercules    │                           │
│  TN3270 Host        ▼                           │
└─────────────────────────────────────────────────┘
```

## Development

```bash
git clone https://github.com/billpereira/vscode-tn3270.git
cd vscode-tn3270
npm install
npm run compile
# Press F5 in VS Code to launch the Extension Development Host
```

## License

MIT — see [LICENSE](LICENSE)

## References

- [zowe/tn3270-ng2](https://github.com/zowe/tn3270-ng2) — Zowe TN3270 emulator
- [mflorence99/tn3270](https://github.com/mflorence99/tn3270) — TypeScript TN3270 library
- [RFC 1576](https://datatracker.ietf.org/doc/rfc1576/) — TN3270 Current Practices
- [RFC 2355](https://datatracker.ietf.org/doc/rfc2355/) — TN3270E

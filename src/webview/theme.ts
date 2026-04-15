/**
 * VS Code theme integration.
 *
 * Detects the active VS Code theme kind and maps it to a 3270 color palette.
 * Sends theme updates to the webview when the theme changes.
 */

import * as vscode from 'vscode';
import type { ThemeColors, ThemeMessage } from './messages';

/** Dark theme: classic green phosphor on black. */
const DARK_COLORS: ThemeColors = {
  background: '#000000',
  foreground: '#33ff33',
  cursor: '#33ff33',
  blue: '#5b9bd5',
  red: '#ff5555',
  pink: '#ff79c6',
  green: '#33ff33',
  turquoise: '#55ffff',
  yellow: '#f1fa8c',
  white: '#f8f8f2',
  oiaBackground: '#007acc',
  oiaForeground: '#ffffff',
};

/** Light theme: dark text on white. */
const LIGHT_COLORS: ThemeColors = {
  background: '#ffffff',
  foreground: '#1e1e1e',
  cursor: '#1e1e1e',
  blue: '#0000cd',
  red: '#cc0000',
  pink: '#cd00cd',
  green: '#008000',
  turquoise: '#008080',
  yellow: '#808000',
  white: '#1e1e1e',
  oiaBackground: '#dddddd',
  oiaForeground: '#333333',
};

/** High-contrast theme: maximum visibility. */
const HIGH_CONTRAST_COLORS: ThemeColors = {
  background: '#000000',
  foreground: '#ffffff',
  cursor: '#ffff00',
  blue: '#6699ff',
  red: '#ff3333',
  pink: '#ff66ff',
  green: '#00ff00',
  turquoise: '#00ffff',
  yellow: '#ffff00',
  white: '#ffffff',
  oiaBackground: '#333333',
  oiaForeground: '#ffffff',
};

/** High-contrast light theme. */
const HIGH_CONTRAST_LIGHT_COLORS: ThemeColors = {
  background: '#ffffff',
  foreground: '#000000',
  cursor: '#000000',
  blue: '#0000aa',
  red: '#aa0000',
  pink: '#aa00aa',
  green: '#006600',
  turquoise: '#006666',
  yellow: '#666600',
  white: '#000000',
  oiaBackground: '#cccccc',
  oiaForeground: '#000000',
};

type ThemeKind = 'dark' | 'light' | 'highContrast' | 'highContrastLight';

/**
 * Get the current VS Code theme kind.
 */
export function getThemeKind(): ThemeKind {
  const kind = vscode.window.activeColorTheme.kind;
  switch (kind) {
    case vscode.ColorThemeKind.Light:
      return 'light';
    case vscode.ColorThemeKind.Dark:
      return 'dark';
    case vscode.ColorThemeKind.HighContrast:
      return 'highContrast';
    case vscode.ColorThemeKind.HighContrastLight:
      return 'highContrastLight';
    default:
      return 'dark';
  }
}

/**
 * Get the color palette for the given theme kind.
 */
export function getColorsForTheme(kind: ThemeKind): ThemeColors {
  switch (kind) {
    case 'light': return { ...LIGHT_COLORS };
    case 'dark': return { ...DARK_COLORS };
    case 'highContrast': return { ...HIGH_CONTRAST_COLORS };
    case 'highContrastLight': return { ...HIGH_CONTRAST_LIGHT_COLORS };
  }
}

/**
 * Build a ThemeMessage for the current VS Code theme.
 */
export function buildThemeMessage(): ThemeMessage {
  const kind = getThemeKind();
  return {
    type: 'theme',
    kind,
    colors: getColorsForTheme(kind),
  };
}

/**
 * Apply user-override colors on top of a theme palette.
 */
export function applyColorOverrides(
  base: ThemeColors,
  overrides: Partial<ThemeColors>,
): ThemeColors {
  return { ...base, ...overrides };
}

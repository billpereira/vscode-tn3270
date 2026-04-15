/**
 * Theme tests — the getThemeKind/buildThemeMessage functions depend on
 * vscode APIs which aren't available in unit tests. We test the pure
 * functions: getColorsForTheme and applyColorOverrides.
 */

jest.mock('vscode', () => ({
  window: { activeColorTheme: { kind: 2 } },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
}), { virtual: true });

import { getColorsForTheme, applyColorOverrides } from '../../../src/webview/theme';
import type { ThemeColors } from '../../../src/webview/messages';

describe('getColorsForTheme', () => {
  it('should return dark palette', () => {
    const colors = getColorsForTheme('dark');
    expect(colors.background).toBe('#000000');
    expect(colors.foreground).toBe('#33ff33');
    expect(colors.green).toBe('#33ff33');
  });

  it('should return light palette', () => {
    const colors = getColorsForTheme('light');
    expect(colors.background).toBe('#ffffff');
    expect(colors.foreground).toBe('#1e1e1e');
  });

  it('should return high contrast palette', () => {
    const colors = getColorsForTheme('highContrast');
    expect(colors.background).toBe('#000000');
    expect(colors.foreground).toBe('#ffffff');
    expect(colors.cursor).toBe('#ffff00');
  });

  it('should return high contrast light palette', () => {
    const colors = getColorsForTheme('highContrastLight');
    expect(colors.background).toBe('#ffffff');
    expect(colors.foreground).toBe('#000000');
  });

  it('should return distinct palettes for each kind', () => {
    const dark = getColorsForTheme('dark');
    const light = getColorsForTheme('light');
    const hc = getColorsForTheme('highContrast');
    expect(dark.background).not.toBe(light.background);
    expect(hc.cursor).not.toBe(dark.cursor);
  });

  it('should return copies (not shared references)', () => {
    const a = getColorsForTheme('dark');
    const b = getColorsForTheme('dark');
    a.background = '#ff0000';
    expect(b.background).toBe('#000000');
  });
});

describe('applyColorOverrides', () => {
  it('should override specific colors', () => {
    const base = getColorsForTheme('dark');
    const result = applyColorOverrides(base, { green: '#00ff00', cursor: '#ff0000' });
    expect(result.green).toBe('#00ff00');
    expect(result.cursor).toBe('#ff0000');
    expect(result.background).toBe('#000000'); // unchanged
  });

  it('should return a new object', () => {
    const base = getColorsForTheme('dark');
    const result = applyColorOverrides(base, { green: '#00ff00' });
    expect(result).not.toBe(base);
  });

  it('should handle empty overrides', () => {
    const base = getColorsForTheme('dark');
    const result = applyColorOverrides(base, {});
    expect(result).toEqual(base);
  });

  it('should handle full override', () => {
    const base = getColorsForTheme('dark');
    const lightColors = getColorsForTheme('light');
    const result = applyColorOverrides(base, lightColors);
    expect(result).toEqual(lightColors);
  });
});

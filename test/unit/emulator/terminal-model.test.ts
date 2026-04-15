import {
  MODEL_3278_2, MODEL_3278_3, MODEL_3278_4, MODEL_3278_5,
  MODEL_3279_2_E, MODEL_3279_3_E, MODEL_3279_4_E, MODEL_3279_5_E,
  DEFAULT_MODEL, getModel, TERMINAL_MODELS,
} from '../../../src/emulator/terminal-model';

describe('terminal models', () => {
  it('should define correct dimensions for 3278-2 (24x80)', () => {
    expect(MODEL_3278_2.rows).toBe(24);
    expect(MODEL_3278_2.cols).toBe(80);
    expect(MODEL_3278_2.altRows).toBe(24);
    expect(MODEL_3278_2.altCols).toBe(80);
    expect(MODEL_3278_2.extended).toBe(false);
  });

  it('should define correct alternate dimensions for 3278-3 (32x80)', () => {
    expect(MODEL_3278_3.altRows).toBe(32);
    expect(MODEL_3278_3.altCols).toBe(80);
  });

  it('should define correct alternate dimensions for 3278-4 (43x80)', () => {
    expect(MODEL_3278_4.altRows).toBe(43);
    expect(MODEL_3278_4.altCols).toBe(80);
  });

  it('should define correct alternate dimensions for 3278-5 (27x132)', () => {
    expect(MODEL_3278_5.altRows).toBe(27);
    expect(MODEL_3278_5.altCols).toBe(132);
  });

  it('should mark -E models as extended', () => {
    expect(MODEL_3279_2_E.extended).toBe(true);
    expect(MODEL_3279_3_E.extended).toBe(true);
    expect(MODEL_3279_4_E.extended).toBe(true);
    expect(MODEL_3279_5_E.extended).toBe(true);
  });

  it('should have all 8 models in the registry', () => {
    expect(TERMINAL_MODELS.size).toBe(8);
  });

  it('should default to IBM-3279-2-E', () => {
    expect(DEFAULT_MODEL).toBe(MODEL_3279_2_E);
  });
});

describe('getModel', () => {
  it('should return the correct model by name', () => {
    expect(getModel('IBM-3278-2')).toBe(MODEL_3278_2);
    expect(getModel('IBM-3279-5-E')).toBe(MODEL_3279_5_E);
  });

  it('should return default for unknown model names', () => {
    expect(getModel('UNKNOWN')).toBe(DEFAULT_MODEL);
  });
});

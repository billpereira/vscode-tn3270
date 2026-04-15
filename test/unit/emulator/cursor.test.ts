import { Cursor } from '../../../src/emulator/cursor';

describe('Cursor', () => {
  let cursor: Cursor;

  beforeEach(() => {
    cursor = new Cursor(24, 80); // standard 24x80
  });

  it('should start at position 0', () => {
    expect(cursor.position).toBe(0);
    expect(cursor.row).toBe(0);
    expect(cursor.col).toBe(0);
  });

  it('should report correct buffer size', () => {
    expect(cursor.bufferSize).toBe(1920); // 24 * 80
  });

  describe('setPosition', () => {
    it('should set to a valid position', () => {
      cursor.setPosition(160); // row 2, col 0
      expect(cursor.position).toBe(160);
      expect(cursor.row).toBe(2);
      expect(cursor.col).toBe(0);
    });

    it('should wrap positive overflow', () => {
      cursor.setPosition(1920); // exactly buffer size
      expect(cursor.position).toBe(0);
    });

    it('should wrap negative values', () => {
      cursor.setPosition(-1);
      expect(cursor.position).toBe(1919); // last position
    });
  });

  describe('advance / retreat', () => {
    it('should advance by 1', () => {
      cursor.advance();
      expect(cursor.position).toBe(1);
    });

    it('should advance by n', () => {
      cursor.advance(80);
      expect(cursor.position).toBe(80);
      expect(cursor.row).toBe(1);
    });

    it('should wrap when advancing past end', () => {
      cursor.setPosition(1919);
      cursor.advance();
      expect(cursor.position).toBe(0);
    });

    it('should retreat by 1', () => {
      cursor.setPosition(5);
      cursor.retreat();
      expect(cursor.position).toBe(4);
    });

    it('should wrap when retreating past start', () => {
      cursor.retreat();
      expect(cursor.position).toBe(1919);
    });
  });

  describe('moveTo', () => {
    it('should move to specific row and col', () => {
      cursor.moveTo(5, 10);
      expect(cursor.row).toBe(5);
      expect(cursor.col).toBe(10);
      expect(cursor.position).toBe(5 * 80 + 10);
    });
  });

  describe('directional movement', () => {
    it('should move up', () => {
      cursor.moveTo(5, 10);
      cursor.moveUp();
      expect(cursor.row).toBe(4);
      expect(cursor.col).toBe(10);
    });

    it('should wrap up from row 0', () => {
      cursor.moveTo(0, 10);
      cursor.moveUp();
      expect(cursor.row).toBe(23);
      expect(cursor.col).toBe(10);
    });

    it('should move down', () => {
      cursor.moveTo(5, 10);
      cursor.moveDown();
      expect(cursor.row).toBe(6);
      expect(cursor.col).toBe(10);
    });

    it('should wrap down from last row', () => {
      cursor.moveTo(23, 10);
      cursor.moveDown();
      expect(cursor.row).toBe(0);
      expect(cursor.col).toBe(10);
    });

    it('should move left', () => {
      cursor.moveTo(5, 10);
      cursor.moveLeft();
      expect(cursor.col).toBe(9);
    });

    it('should move right', () => {
      cursor.moveTo(5, 10);
      cursor.moveRight();
      expect(cursor.col).toBe(11);
    });
  });

  describe('moveToStartOfRow', () => {
    it('should move to column 0 of current row', () => {
      cursor.moveTo(5, 35);
      cursor.moveToStartOfRow();
      expect(cursor.row).toBe(5);
      expect(cursor.col).toBe(0);
    });
  });

  describe('address conversion', () => {
    it('should convert address to row,col', () => {
      expect(cursor.addressToRowCol(165)).toEqual([2, 5]);
    });

    it('should convert row,col to address', () => {
      expect(cursor.rowColToAddress(2, 5)).toBe(165);
    });

    it('should wrap address in addressToRowCol', () => {
      expect(cursor.addressToRowCol(1920)).toEqual([0, 0]);
    });
  });

  describe('resize', () => {
    it('should update dimensions', () => {
      cursor.resize(43, 80);
      expect(cursor.bufferSize).toBe(3440);
    });

    it('should clamp position if out of bounds after resize', () => {
      cursor.setPosition(1919);
      cursor.resize(10, 10); // 100 cells
      expect(cursor.position).toBe(0);
    });

    it('should keep position if still valid after resize', () => {
      cursor.setPosition(50);
      cursor.resize(43, 80);
      expect(cursor.position).toBe(50);
    });
  });
});

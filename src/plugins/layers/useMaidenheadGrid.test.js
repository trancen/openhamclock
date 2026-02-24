/**
 * Maidenhead Grid Plugin Tests
 *
 * Tests for the IARU Maidenhead Grid Locator system implementation
 * Following OpenHamClock testing guidelines
 */
import { describe, it, expect } from 'vitest';
import {
  latLonToMaidenhead,
  maidenheadToBounds,
  getGridLevelsForZoom,
  calculateGridForBounds,
  GRID_PRECISIONS,
} from '../plugins/layers/useMaidenheadGrid.js';

describe('Maidenhead Grid Utilities', () => {
  describe('latLonToMaidenhead - Basic Conversion', () => {
    it('should return empty string for invalid coordinates', () => {
      expect(latLonToMaidenhead(NaN, 0)).toBe('');
      expect(latLonToMaidenhead(0, NaN)).toBe('');
      expect(latLonToMaidenhead(Infinity, 0)).toBe('');
      expect(latLonToMaidenhead(0, Infinity)).toBe('');
      expect(latLonToMaidenhead(undefined, 0)).toBe('');
      expect(latLonToMaidenhead(0, undefined)).toBe('');
    });

    it('should clamp latitude to valid range', () => {
      // Test latitudes outside valid range
      expect(latLonToMaidenhead(100, 0, 4)).toBe(latLonToMaidenhead(90, 0, 4));
      expect(latLonToMaidenhead(-100, 0, 4)).toBe(latLonToMaidenhead(-90, 0, 4));
    });

    it('should handle precision of 2 (Fields only)', () => {
      // New York City area
      expect(latLonToMaidenhead(40.7128, -74.006, 2)).toBe('FN');
      // London area
      expect(latLonToMaidenhead(51.5074, -0.1278, 2)).toBe('IO');
      // Tokyo area
      expect(latLonToMaidenhead(35.6762, 139.6503, 2)).toBe('PM');
      // Sydney area
      expect(latLonToMaidenhead(-33.8688, 151.2093, 2)).toBe('QF');
      // Center of USA
      expect(latLonToMaidenhead(39.8283, -98.5795, 2)).toBe('DM');
    });

    it('should handle precision of 4 (Squares)', () => {
      // New York City - FN31
      expect(latLonToMaidenhead(40.7128, -74.006, 4)).toBe('FN31');
      // London - IO91
      expect(latLonToMaidenhead(51.5074, -0.1278, 4)).toBe('IO91');
      // Tokyo - PM95
      expect(latLonToMaidenhead(35.6762, 139.6503, 4)).toBe('PM95');
      // Center of USA - DM89
      expect(latLonToMaidenhead(39.8283, -98.5795, 4)).toBe('DM89');
    });

    it('should handle precision of 6 (Sub-squares)', () => {
      // New York City - FN31pv
      expect(latLonToMaidenhead(40.7128, -74.006, 6)).toBe('FN31pv');
      // London - IO91wm
      expect(latLonToMaidenhead(51.5074, -0.1278, 6)).toBe('IO91wm');
      // Tokyo - PM95ix
      expect(latLonToMaidenhead(35.6762, 139.6503, 6)).toBe('PM95ix');
    });

    it('should handle precision of 8 (Extended)', () => {
      // New York City - FN31pv44
      expect(latLonToMaidenhead(40.7128, -74.006, 8)).toBe('FN31pv44');
      // London - IO91wm98
      expect(latLonToMaidenhead(51.5074, -0.1278, 8)).toBe('IO91wm98');
    });

    it('should handle edge cases at grid boundaries', () => {
      // Prime meridian
      expect(latLonToMaidenhead(51.5074, 0, 4)).toMatch(/^[A-R][A-R]\d\d$/);
      // International date line
      expect(latLonToMaidenhead(51.5074, 180, 4)).toMatch(/^[A-R][A-R]\d\d$/);
      // Equator
      expect(latLonToMaidenhead(0, 0, 4)).toMatch(/^[A-R][A-R]\d\d$/);
    });
  });

  describe('maidenheadToBounds', () => {
    it('should return null for invalid grid', () => {
      expect(maidenheadToBounds('')).toBeNull();
      expect(maidenheadToBounds(null)).toBeNull();
      expect(maidenheadToBounds(undefined)).toBeNull();
    });

    it('should calculate bounds for 2-character grid (Fields)', () => {
      const bounds = maidenheadToBounds('FN');
      expect(bounds).not.toBeNull();
      expect(bounds.minLon).toBe(-80); // F = 4, 4*20 - 180 = -100 (wait, 4*20-180=-100... let me recalculate)
      // F = fieldLon = 5 (65+5=70=F), 5*20 - 180 = -100
      // Actually F is 5 from A (0), so minLon = 5*20-180 = -80
      expect(bounds.minLat).toBe(40);  // N = 13 (65+13=78=N), 13*10-90 = 40
      expect(bounds.maxLon).toBe(-60); // -80 + 20
      expect(bounds.maxLat).toBe(50);  // 40 + 10
    });

    it('should calculate bounds for 4-character grid (Squares)', () => {
      const bounds = maidenheadToBounds('FN31');
      expect(bounds).not.toBeNull();
      // FN: minLon=-80, maxLon=-60, minLat=40, maxLat=50
      // 3: squareLon=3, minLon = -80 + 3*2 = -74
      // 1: squareLat=1, minLat = 40 + 1*1 = 41
      expect(bounds.minLon).toBe(-74);
      expect(bounds.maxLon).toBe(-72);
      expect(bounds.minLat).toBe(41);
      expect(bounds.maxLat).toBe(42);
    });

    it('should handle 6-character grid (Sub-squares)', () => {
      const bounds = maidenheadToBounds('FN31pv');
      expect(bounds).not.toBeNull();
      // FN31 + sub-square
      expect(bounds.minLon).toBeCloseTo(-74.0417, 3);
      expect(bounds.maxLon).toBeCloseTo(-74.0, 3);
      expect(bounds.minLat).toBeCloseTo(41.0417, 3);
      expect(bounds.maxLat).toBeCloseTo(41.0833, 3);
    });
  });

  describe('getGridLevelsForZoom', () => {
    it('should always show fields at any zoom', () => {
      expect(getGridLevelsForZoom(0).fields).toBe(true);
      expect(getGridLevelsForZoom(1).fields).toBe(true);
      expect(getGridLevelsForZoom(5).fields).toBe(true);
    });

    it('should show squares at zoom 3+', () => {
      expect(getGridLevelsForZoom(2).squares).toBe(false);
      expect(getGridLevelsForZoom(3).squares).toBe(true);
      expect(getGridLevelsForZoom(5).squares).toBe(true);
    });

    it('should show sub-squares at zoom 6+', () => {
      expect(getGridLevelsForZoom(5).subSquares).toBe(false);
      expect(getGridLevelsForZoom(6).subSquares).toBe(true);
      expect(getGridLevelsForZoom(8).subSquares).toBe(true);
    });

    it('should show extended grid at zoom 9+', () => {
      expect(getGridLevelsForZoom(8).extended).toBe(false);
      expect(getGridLevelsForZoom(9).extended).toBe(true);
    });

    it('should show labels at zoom 4+', () => {
      expect(getGridLevelsForZoom(3).labels).toBe(false);
      expect(getGridLevelsForZoom(4).labels).toBe(true);
    });
  });

  describe('calculateGridForBounds', () => {
    it('should return grid lines and labels for given bounds', () => {
      const bounds = {
        south: 40,
        north: 42,
        west: -74,
        east: -72,
      };

      const result = calculateGridForBounds(bounds, 4);

      expect(result.lines).toBeInstanceOf(Array);
      expect(result.labels).toBeInstanceOf(Array);
      // At precision 4, we should have longitude lines at -74, -72
      // And latitude lines at 40, 41, 42
      expect(result.lines.some((l) => l.type === 'vertical')).toBe(true);
      expect(result.lines.some((l) => l.type === 'horizontal')).toBe(true);
    });

    it('should include minor grid lines for precision 6+', () => {
      const bounds = {
        south: 40,
        north: 42,
        west: -74,
        east: -72,
      };

      const result4 = calculateGridForBounds(bounds, 4);
      const result6 = calculateGridForBounds(bounds, 6);

      const minorLines4 = result4.lines.filter((l) => l.minor);
      const minorLines6 = result6.lines.filter((l) => l.minor);

      expect(minorLines4.length).toBe(0);
      expect(minorLines6.length).toBeGreaterThan(0);
    });

    it('should generate labels at grid centers', () => {
      const bounds = {
        south: 40,
        north: 42,
        west: -74,
        east: -72,
      };

      const result = calculateGridForBounds(bounds, 4);

      // Should have at least one label
      expect(result.labels.length).toBeGreaterThan(0);
      // Labels should be 4-character grids
      result.labels.forEach((label) => {
        expect(label.text.length).toBe(4);
        expect(label.text).toMatch(/^[A-R][A-R]\d\d$/);
      });
    });
  });

  describe('GRID_PRECISIONS', () => {
    it('should have correct precision values', () => {
      expect(GRID_PRECISIONS.FIELDS).toBe(2);
      expect(GRID_PRECISIONS.SQUARES).toBe(4);
      expect(GRID_PRECISIONS.SUB_SQUARES).toBe(6);
      expect(GRID_PRECISIONS.EXTENDED).toBe(8);
    });
  });

  describe('Coordinate edge cases', () => {
    it('should handle longitude wrap-around correctly', () => {
      // Test coordinates near the international date line
      const grid1 = latLonToMaidenhead(0, 179.9, 4);
      const grid2 = latLonToMaidenhead(0, -179.9, 4);
      // These should produce valid grid squares
      expect(grid1.length).toBe(4);
      expect(grid2.length).toBe(4);
    });

    it('should handle very small decimal precision', () => {
      // Very precise coordinates should still work
      const grid = latLonToMaidenhead(40.71281234, -74.00601234, 8);
      expect(grid.length).toBe(8);
    });
  });
});

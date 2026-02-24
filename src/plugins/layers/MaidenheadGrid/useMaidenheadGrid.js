/**
 * Maidenhead Grid Overlay Plugin
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// Grid precision options
export const GRID_PRECISIONS = {
  FIELDS: 2,
  SQUARES: 4,
  SUB_SQUARES: 6,
  EXTENDED: 8,
};

/**
 * Convert latitude/longitude to Maidenhead grid square
 */
export function latLonToMaidenhead(lat, lon, precision = 4) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return '';
  }

  lat = Math.max(-90, Math.min(90, lat));
  lon = ((lon + 180) % 360 + 360) % 360;

  const result = [];

  // Field (20 deg x 10 deg)
  const fieldLon = Math.floor(lon / 20);
  const fieldLat = Math.floor(lat / 10);
  result.push(String.fromCharCode(65 + (fieldLon % 18)));
  result.push(String.fromCharCode(65 + (fieldLat % 18)));

  if (precision >= 4) {
    const squareLon = Math.floor((lon % 20) / 2);
    const squareLat = Math.floor(lat % 10);
    result.push(String.fromCharCode(48 + (squareLon % 10)));
    result.push(String.fromCharCode(48 + (squareLat % 10)));
  }

  return result.slice(0, precision).join('');
}

/**
 * Calculate bounding box for a Maidenhead grid square
 */
export function maidenheadToBounds(grid) {
  if (!grid || grid.length < 2) return null;

  grid = grid.toUpperCase().substring(0, 8);

  const fieldLon = grid.charCodeAt(0) - 65;
  const fieldLat = grid.charCodeAt(1) - 65;
  let minLon = fieldLon * 20 - 180;
  let maxLon = minLon + 20;
  let minLat = fieldLat * 10 - 90;
  let maxLat = minLat + 10;

  if (grid.length >= 4) {
    const squareLon = parseInt(grid[2], 10) || 0;
    const squareLat = parseInt(grid[3], 10) || 0;
    minLon = fieldLon * 20 + squareLon * 2;
    maxLon = minLon + 2;
    minLat = fieldLat * 10 + squareLat;
    maxLat = minLat + 1;
  }

  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Determine which grid levels to display based on zoom level
 */
export function getGridLevelsForZoom(zoom) {
  return {
    fields: zoom >= 1,
    squares: zoom >= 3,
    subSquares: zoom >= 6,
    extended: zoom >= 9,
    labels: zoom >= 4,
  };
}

/**
 * Calculate grid lines for the visible viewport
 */
export function calculateGridForBounds(bounds, precision) {
  const lines = [];
  const labels = [];

  const south = Math.max(-90, bounds.south);
  const north = Math.min(90, bounds.north);
  const west = ((bounds.west + 180) % 360 + 360) % 360;
  const east = ((bounds.east + 180) % 360 + 360) % 360;

  const lonStep = precision >= 4 ? 2 : 20;
  const latStep = precision >= 4 ? 1 : 10;

  // Longitude lines
  for (let lon = Math.floor(west / lonStep) * lonStep; lon <= Math.ceil(east / lonStep) * lonStep; lon += lonStep) {
    const nLon = ((lon + 180) % 360 + 360) % 360 - 180;
    if (nLon > -180 && nLon < 180) {
      lines.push({ type: 'vertical', value: nLon, from: south, to: north });
    }
  }

  // Latitude lines
  for (let lat = Math.floor(south / latStep) * latStep; lat <= Math.ceil(north / latStep) * latStep; lat += latStep) {
    if (lat > -90 && lat < 90) {
      lines.push({ type: 'horizontal', value: lat, from: west, to: east });
    }
  }

  // Labels
  if (precision >= 2) {
    const labelStepLon = precision >= 4 ? 2 : 20;
    const labelStepLat = precision >= 4 ? 1 : 10;
    for (let lon = Math.floor(west / labelStepLon) * labelStepLon + labelStepLon / 2; lon < Math.ceil(east / labelStepLon) * labelStepLon; lon += labelStepLon) {
      for (let lat = Math.floor(south / labelStepLat) * labelStepLat + labelStepLat / 2; lat < Math.ceil(north / labelStepLat) * labelStepLat; lat += labelStepLat) {
        const grid = latLonToMaidenhead(lat, lon, precision);
        if (grid) {
          labels.push({ text: grid, lat, lon: ((lon + 180) % 360 + 360) % 360 - 180 });
        }
      }
    }
  }

  return { lines, labels };
}

// Plugin metadata
export const metadata = {
  id: 'maidenheadgrid',
  name: 'Maidenhead Grid',
  description: 'IARU Maidenhead Grid Locator overlay with configurable precision',
  icon: '⊞',
  category: 'overlay',
  defaultEnabled: false,
  defaultOpacity: 0.7,
  version: '1.0.0',
  localOnly: false,
};

// Main plugin hook - with canvas initialization
export function useLayer({ map, enabled, opacity }) {
  const [precision, setPrecision] = useState(4);
  const [showLabels, setShowLabels] = useState(true);
  const canvasRef = useRef(null);
  const layerRef = useRef(null);

  // Load saved preferences
  useEffect(() => {
    const savedPrecision = localStorage.getItem('maidenhead-grid-precision');
    const savedLabels = localStorage.getItem('maidenhead-grid-labels');

    if (savedPrecision) {
      const parsed = parseInt(savedPrecision, 10);
      if ([2, 4, 6, 8].includes(parsed)) {
        setPrecision(parsed);
      }
    }

    if (savedLabels !== null) {
      setShowLabels(savedLabels !== 'false');
    }
  }, []);

  // Initialize canvas layer
  useEffect(() => {
    if (!map || !enabled) return;
    if (layerRef.current) return; // Already initialized

    const L = window.L;
    if (!L) return;

    // Create canvas element
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position: absolute; top: 0; left: 0; pointer-events: none; z-index: 400;';
    canvas.width = map.getSize().x;
    canvas.height = map.getSize().y;
    canvasRef.current = canvas;

    // Get overlay pane and append canvas
    const pane = map.getPane('overlayPane');
    if (pane) {
      pane.appendChild(canvas);
    }

    // Cleanup
    layerRef.current = {
      remove: () => {
        if (canvas.parentNode) {
          canvas.parentNode.removeChild(canvas);
        }
        layerRef.current = null;
      }
    };

    return () => {
      if (layerRef.current) {
        layerRef.current.remove();
      }
    };
  }, [map, enabled]);

  // Return null - canvas is rendered directly to DOM
  return null;
}

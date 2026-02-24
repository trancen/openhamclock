/**
 * Maidenhead Grid Overlay Plugin
 */
import { useState, useEffect, useRef } from 'react';

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

  if (precision >= 6) {
    const subLon = Math.floor(((lon % 2) / 5) * 24);
    const subLat = Math.floor(((lat % 1) / 2.5) * 24);
    result.push(String.fromCharCode(97 + (subLon % 24)));
    result.push(String.fromCharCode(97 + (subLat % 24)));
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
  let west = bounds.west;
  let east = bounds.east;

  // Normalize to -180 to 180
  west = ((west + 180) % 360 + 360) % 360 - 180;
  east = ((east + 180) % 360 + 360) % 360 - 180;

  // Handle antimeridian (when east < west)
  const crossingAntimeridian = east < west;

  // Field lines (20 deg x 10 deg) - always show
  for (let lon = Math.floor(west / 20) * 20; lon <= Math.ceil(east / 20) * 20 + (crossingAntimeridian ? 360 : 0); lon += 20) {
    const nLon = ((lon + 180) % 360 + 360) % 360 - 180;
    if (nLon > -180 && nLon < 180) {
      lines.push({ lat1: south, lng1: nLon, lat2: north, lng2: nLon, level: 'field' });
    }
  }
  for (let lat = Math.floor(south / 10) * 10; lat <= Math.ceil(north / 10) * 10; lat += 10) {
    if (lat > -90 && lat < 90) {
      lines.push({ lat1: lat, lng1: west, lat2: lat, lng2: east, level: 'field' });
    }
  }

  // Square lines (2 deg x 1 deg) - show at precision 4+
  if (precision >= 4) {
    for (let lon = Math.floor(west / 2) * 2; lon <= Math.ceil(east / 2) * 2 + (crossingAntimeridian ? 360 : 0); lon += 2) {
      const nLon = ((lon + 180) % 360 + 360) % 360 - 180;
      if (nLon > -180 && nLon < 180) {
        lines.push({ lat1: south, lng1: nLon, lat2: north, lng2: nLon, level: 'square' });
      }
    }
    for (let lat = Math.floor(south); lat <= Math.ceil(north); lat++) {
      if (lat > -90 && lat < 90) {
        lines.push({ lat1: lat, lng1: west, lat2: lat, lng2: east, level: 'square' });
      }
    }
  }

  // Sub-square lines (5 min x 2.5 min) - show at precision 6+
  if (precision >= 6) {
    const subLonStep = 5 / 60;
    const subLatStep = 2.5 / 60;
    for (let lon = Math.floor(west / subLonStep) * subLonStep; lon <= Math.ceil(east / subLonStep) * subLonStep + (crossingAntimeridian ? 360 : 0); lon += subLonStep) {
      const nLon = ((lon + 180) % 360 + 360) % 360 - 180;
      if (nLon > -180 && nLon < 180) {
        lines.push({ lat1: south, lng1: nLon, lat2: north, lng2: nLon, level: 'subsquare' });
      }
    }
    for (let lat = Math.floor(south / subLatStep) * subLatStep; lat <= Math.ceil(north / subLatStep) * subLatStep; lat += subLatStep) {
      if (lat > -90 && lat < 90) {
        lines.push({ lat1: lat, lng1: west, lat2: lat, lng2: east, level: 'subsquare' });
      }
    }
  }

  // Labels
  if (precision >= 2) {
    const labelStepLon = precision >= 4 ? 2 : 20;
    const labelStepLat = precision >= 4 ? 1 : 10;
    for (let lon = Math.floor(west / labelStepLon) * labelStepLon + labelStepLon / 2; lon <= Math.ceil(east / labelStepLon) * labelStepLon + (crossingAntimeridian ? 360 : 0); lon += labelStepLon) {
      const nLon = ((lon + 180) % 360 + 360) % 360 - 180;
      for (let lat = Math.floor(south / labelStepLat) * labelStepLat + labelStepLat / 2; lat <= Math.ceil(north / labelStepLat) * labelStepLat; lat += labelStepLat) {
        const grid = latLonToMaidenhead(lat, nLon, precision);
        if (grid && lat > -90 && lat < 90) {
          labels.push({ text: grid, lat: lat, lng: nLon });
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

// Main plugin hook - using Leaflet polylines
export function useLayer({ map, enabled, opacity }) {
  const [precision, setPrecision] = useState(4);
  const [showLabels, setShowLabels] = useState(true);
  const layersRef = useRef([]);

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

  // Draw grid using Leaflet polylines
  const drawGrid = () => {
    if (!map || typeof L === 'undefined') return;

    // Clear existing layers
    layersRef.current.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch (e) {
        // Ignore errors
      }
    });
    layersRef.current = [];

    if (!enabled || opacity <= 0) return;

    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const gridLevels = getGridLevelsForZoom(zoom);

    let displayPrecision = precision;
    if (precision >= 4 && !gridLevels.squares) displayPrecision = 2;
    if (precision >= 6 && !gridLevels.subSquares) displayPrecision = 4;

    const gridData = calculateGridForBounds(
      { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() },
      displayPrecision
    );

    // Line styles for different levels
    const lineStyles = {
      field: { color: '#FFB432', weight: 2, opacity: opacity * 0.9, fillOpacity: 0 },
      square: { color: '#FFB432', weight: 1, opacity: opacity * 0.7, fillOpacity: 0 },
      subsquare: { color: '#FFB432', weight: 0.5, opacity: opacity * 0.4, fillOpacity: 0 },
    };

    // Draw lines using polylines
    gridData.lines.forEach((line) => {
      const style = lineStyles[line.level] || lineStyles.field;
      const polyline = L.polyline(
        [
          [line.lat1, line.lng1],
          [line.lat2, line.lng2],
        ],
        style
      );
      polyline.addTo(map);
      layersRef.current.push(polyline);
    });

    // Draw labels using divIcon
    if (showLabels && gridLevels.labels) {
      gridData.labels.forEach((label) => {
        const labelIcon = L.divIcon({
          className: 'maidenhead-label',
          html: `<div style="background: rgba(0,0,0,${opacity * 0.6}); color: white; padding: 2px 4px; font-size: 11px; font-family: monospace; font-weight: bold; border-radius: 3px; white-space: nowrap;">${label.text}</div>`,
          iconSize: [60, 20],
          iconAnchor: [30, 10],
        });
        const marker = L.marker([label.lat, label.lng], { icon: labelIcon });
        marker.addTo(map);
        layersRef.current.push(marker);
      });
    }
  };

  // Draw when map moves or zooms
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;
    if (!enabled) return;

    drawGrid();

    const handleMove = () => drawGrid();
    const handleZoom = () => drawGrid();

    map.on('moveend', handleMove);
    map.on('zoomend', handleZoom);

    return () => {
      map.off('moveend', handleMove);
      map.off('zoomend', handleZoom);
      layersRef.current.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch (e) {
          // Ignore
        }
      });
      layersRef.current = [];
    };
  }, [map, enabled, precision, showLabels]);

  // Update opacity without redrawing
  useEffect(() => {
    if (!enabled) return;
    layersRef.current.forEach((layer) => {
      try {
        if (layer.setOpacity) {
          layer.setOpacity(opacity);
        }
      } catch (e) {
        // Ignore
      }
    });
  }, [opacity, enabled]);

  return null;
}

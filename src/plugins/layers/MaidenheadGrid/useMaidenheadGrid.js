/**
 * Maidenhead Grid Overlay Plugin
 *
 * Displays IARU Maidenhead grid square overlay on the map.
 * Supports multiple precision levels (2, 4, 6, 8 characters) with adaptive grid scaling.
 */
import { useEffect, useRef, useState, useCallback } from 'react';

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

  // Field (20° x 10°)
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

  if (precision >= 8) {
    const extLon = Math.floor((((lon % (2 / 60)) / (30 / 3600)) * 10));
    const extLat = Math.floor((((lat % (1 / 60)) / (15 / 3600)) * 10));
    result.push(String.fromCharCode(48 + (extLon % 10)));
    result.push(String.fromCharCode(48 + (extLat % 10)));
  }

  return result.slice(0, precision).join('');
}

/**
 * Calculate bounding box for a Maidenhead grid square
 */
export function maidenheadToBounds(grid) {
  if (!grid || grid.length < 2) return null;

  grid = grid.toUpperCase().substring(0, 8);

  let minLon, maxLon, minLat, maxLat;

  const fieldLon = grid.charCodeAt(0) - 65;
  const fieldLat = grid.charCodeAt(1) - 65;
  minLon = fieldLon * 20 - 180;
  maxLon = minLon + 20;
  minLat = fieldLat * 10 - 90;
  maxLat = minLat + 10;

  if (grid.length >= 4 && /^\d\d$/.test(grid.substring(2, 4))) {
    const squareLon = parseInt(grid[2], 10);
    const squareLat = parseInt(grid[3], 10);
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

  let lonStep, latStep, lonSubStep, latSubStep;

  switch (precision) {
    case 2:
      lonStep = 20;
      latStep = 10;
      break;
    case 4:
      lonStep = 2;
      latStep = 1;
      break;
    case 6:
    case 8:
      lonStep = 2;
      latStep = 1;
      lonSubStep = 5 / 60;
      latSubStep = 2.5 / 60;
      break;
    default:
      lonStep = 2;
      latStep = 1;
  }

  // Longitude lines
  const startLon = Math.floor(west / lonStep) * lonStep;
  const endLon = Math.ceil(east / lonStep) * lonStep;

  for (let lon = startLon; lon <= endLon; lon += lonStep) {
    const normalizedLon = ((lon + 180) % 360 + 360) % 360 - 180;
    if (normalizedLon > -180 && normalizedLon < 180) {
      lines.push({ type: 'vertical', value: normalizedLon, from: south, to: north });
    }
  }

  // Latitude lines
  const startLat = Math.floor(south / latStep) * latStep;
  const endLat = Math.ceil(north / latStep) * latStep;

  for (let lat = startLat; lat <= endLat; lat += latStep) {
    if (lat > -90 && lat < 90) {
      lines.push({ type: 'horizontal', value: lat, from: west, to: east });
    }
  }

  // Sub-square lines for precision >= 6
  if (precision >= 6 && lonSubStep && latSubStep) {
    const subStartLon = Math.floor(west / lonSubStep) * lonSubStep;
    const subEndLon = Math.ceil(east / lonSubStep) * lonSubStep;
    const subStartLat = Math.floor(south / latSubStep) * latSubStep;
    const subEndLat = Math.ceil(north / latSubStep) * latSubStep;

    for (let lon = subStartLon; lon <= subEndLon; lon += lonSubStep) {
      const normalizedLon = ((lon + 180) % 360 + 360) % 360 - 180;
      if (normalizedLon > -180 && normalizedLon < 180 && lon % lonStep !== 0) {
        lines.push({ type: 'vertical', value: normalizedLon, from: south, to: north, minor: true });
      }
    }

    for (let lat = subStartLat; lat <= subEndLat; lat += latSubStep) {
      if (lat > -90 && lat < 90 && lat % latStep !== 0) {
        lines.push({ type: 'horizontal', value: lat, from: west, to: east, minor: true });
      }
    }
  }

  // Labels
  if (precision >= 2) {
    const labelStepLon = precision >= 4 ? 2 : 20;
    const labelStepLat = precision >= 4 ? 1 : 10;

    const labelStartLon = Math.floor(west / labelStepLon) * labelStepLon + labelStepLon / 2;
    const labelEndLon = Math.ceil(east / labelStepLon) * labelStepLon;
    const labelStartLat = Math.floor(south / labelStepLat) * labelStepLat + labelStepLat / 2;
    const labelEndLat = Math.ceil(north / labelStepLat) * labelStepLat;

    for (let lon = labelStartLon; lon < labelEndLon; lon += labelStepLon) {
      for (let lat = labelStartLat; lat < labelEndLat; lat += labelStepLat) {
        const grid = latLonToMaidenhead(lat, lon, precision);
        if (grid) {
          labels.push({
            text: grid,
            lat,
            lon: ((lon + 180) % 360 + 360) % 360 - 180,
          });
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

// Main plugin hook
export function useLayer({ map, enabled, opacity }) {
  const [precision, setPrecision] = useState(4);
  const [showLabels, setShowLabels] = useState(true);

  const canvasRef = useRef(null);
  const controlRef = useRef(null);

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

  // Draw grid function
  const drawGrid = useCallback(() => {
    if (!map || !canvasRef.current || !enabled) return;

    const L = window.L;
    if (!L) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const bounds = map.getBounds();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (opacity <= 0) return;

    const majorColor = `rgba(255, 180, 50, ${opacity * 0.8})`;
    const minorColor = `rgba(255, 180, 50, ${opacity * 0.4})`;
    const labelColor = `rgba(255, 255, 255, ${opacity})`;

    const zoom = map.getZoom();
    const gridLevels = getGridLevelsForZoom(zoom);

    let displayPrecision = precision;
    if (precision >= 4 && !gridLevels.squares) displayPrecision = 2;
    if (precision >= 6 && !gridLevels.subSquares) displayPrecision = 4;
    if (precision >= 8 && !gridLevels.extended) displayPrecision = 6;

    const gridData = calculateGridForBounds(
      { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() },
      displayPrecision
    );

    ctx.lineWidth = 1;

    gridData.lines.forEach((line) => {
      ctx.strokeStyle = line.minor ? minorColor : majorColor;
      const p1 = map.latLngToContainerPoint([line.from, line.value]);
      const p2 = map.latLngToContainerPoint([line.to, line.value]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    });

    if (showLabels && gridLevels.labels && precision >= 2) {
      ctx.font = `${Math.max(10, 12 - zoom * 0.5)}px monospace`;
      ctx.fillStyle = labelColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const labelFilter = precision >= 6 ? 1 : precision >= 4 ? 2 : 4;
      let labelCount = 0;

      gridData.labels.forEach((label) => {
        if (labelCount % labelFilter === 0) {
          const point = map.latLngToContainerPoint([label.lat, label.lon]);
          if (point.x > 0 && point.x < canvas.width && point.y > 0 && point.y < canvas.height) {
            const textWidth = ctx.measureText(label.text).width;
            ctx.fillStyle = `rgba(0, 0, 0, ${opacity * 0.5})`;
            ctx.fillRect(point.x - textWidth / 2 - 2, point.y - 7, textWidth + 4, 14);
            ctx.fillStyle = labelColor;
            ctx.fillText(label.text, point.x, point.y);
            labelCount++;
          }
        }
      });
    }
  }, [map, enabled, opacity, precision, showLabels]);

  // Initialize canvas and control
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    const L = window.L;

    // Create canvas
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.style.cssText = 'position: absolute; top: 0; left: 0; pointer-events: none; z-index: 400;';
    }

    const pane = map.getPane('overlayPane');
    if (!canvasRef.current.parentNode) {
      pane.appendChild(canvasRef.current);
    }

    const size = map.getSize();
    canvasRef.current.width = size.x;
    canvasRef.current.height = size.y;

    // Create control
    const MaidenheadGridControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        container.style.cssText = 'background: rgba(0,0,0,0.8); padding: 8px; border-radius: 4px; min-width: 140px; font-family: monospace;';

        container.innerHTML = `
          <div style="margin-bottom: 8px;">
            <label style="color: #aaa; font-size: 10px; display: block; margin-bottom: 4px;">Grid Precision</label>
            <select id="maidenhead-precision" style="width: 100%; padding: 4px; background: rgba(0,0,0,0.5); color: #fff; border: 1px solid #555; border-radius: 4px; font-size: 11px;">
              <option value="2" ${precision === 2 ? 'selected' : ''}>Fields (AB)</option>
              <option value="4" ${precision === 4 ? 'selected' : ''}>Squares (AB12)</option>
              <option value="6" ${precision === 6 ? 'selected' : ''}>Sub-sq (AB12cd)</option>
              <option value="8" ${precision === 8 ? 'selected' : ''}>Extended</option>
            </select>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="maidenhead-labels" ${showLabels ? 'checked' : ''} style="cursor: pointer;">
            <label for="maidenhead-labels" style="color: #aaa; font-size: 11px; cursor: pointer;">Show Labels</label>
          </div>
        `;
        return container;
      },
    });

    controlRef.current = new MaidenheadGridControl();
    map.addControl(controlRef.current);

    // Event handlers
    setTimeout(() => {
      const precisionSelect = document.getElementById('maidenhead-precision');
      const labelsCheckbox = document.getElementById('maidenhead-labels');

      if (precisionSelect) {
        precisionSelect.addEventListener('change', (e) => {
          const val = parseInt(e.target.value, 10);
          if ([2, 4, 6, 8].includes(val)) {
            setPrecision(val);
            localStorage.setItem('maidenhead-grid-precision', val);
          }
        });
      }

      if (labelsCheckbox) {
        labelsCheckbox.addEventListener('change', (e) => {
          setShowLabels(e.target.checked);
          localStorage.setItem('maidenhead-grid-labels', e.target.checked);
        });
      }
    }, 100);

    // Map events
    const handleMoveEnd = () => {
      if (enabled) {
        const size = map.getSize();
        canvasRef.current.width = size.x;
        canvasRef.current.height = size.y;
        drawGrid();
      }
    };

    map.on('moveend', handleMoveEnd);
    map.on('zoomend', handleMoveEnd);

    if (enabled) {
      drawGrid();
    }

    return () => {
      map.off('moveend', handleMoveEnd);
      map.off('zoomend', handleMoveEnd);
      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.parentNode.removeChild(canvasRef.current);
      }
    };
  }, [map, drawGrid, enabled, precision, showLabels]);

  // Redraw on changes
  useEffect(() => {
    if (enabled && canvasRef.current && map) {
      drawGrid();
    }
  }, [enabled, opacity, precision, showLabels, drawGrid, map]);
}

export default { metadata, useLayer };

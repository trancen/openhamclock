/**
 * Maidenhead Grid Overlay Plugin
 *
 * Displays IARU Maidenhead grid square overlay on the map.
 * Supports multiple precision levels (2, 4, 6, 8 characters) with adaptive grid scaling.
 *
 * Features:
 * - Canvas-based rendering for performance
 * - Multiple zoom levels with adaptive grid display
 * - Configurable precision (Fields, Squares, Sub-squares, Extended)
 * - Opacity control integration
 * - Efficient viewport-only rendering
 *
 * SECURITY NOTES:
 * - No external data sources - all calculations are local
 * - Grid identifiers are sanitized before display
 * - Canvas rendering prevents DOM-based injection attacks
 * - No user-generated content is rendered
 */

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';

// Grid precision options
export const GRID_PRECISIONS = {
  FIELDS: 2,      // "AB" - Fields (20° x 10°)
  SQUARES: 4,     // "AB12" - Squares (2° x 1°)
  SUB_SQUARES: 6, // "AB12cd" - Sub-squares (5' x 2.5')
  EXTENDED: 8,    // "AB12cd34" - Extended (30" x 15")
};

/**
 * Convert latitude/longitude to Maidenhead grid square
 * Implements the IARU Maidenhead Grid Locator system
 * Reference: https://www.tvcomm.co.uk/g7izu/the-iaru-maidenhead-grid-locator-system/
 *
 * @param {number} lat - Latitude in degrees (-90 to 90)
 * @param {number} lon - Longitude in degrees (-180 to 180)
 * @param {number} precision - Character precision (2, 4, 6, or 8)
 * @returns {string} Maidenhead grid square
 */
export function latLonToMaidenhead(lat, lon, precision = 4) {
  // Validate inputs - SECURITY: prevent injection via invalid coordinates
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return '';
  }

  // Clamp values to valid ranges
  lat = Math.max(-90, Math.min(90, lat));
  lon = ((lon + 180) % 360 + 360) % 360;

  const result = [];

  // Field (20° x 10°) - 2 characters
  const fieldLon = Math.floor(lon / 20);
  const fieldLat = Math.floor(lat / 10);
  result.push(String.fromCharCode(65 + (fieldLon % 18))); // A-R (18 fields)
  result.push(String.fromCharCode(65 + (fieldLat % 18))); // A-R

  if (precision >= 4) {
    // Square (2° x 1°) - 4 characters
    const squareLon = Math.floor((lon % 20) / 2);
    const squareLat = Math.floor(lat % 10);
    result.push(String.fromCharCode(48 + (squareLon % 10))); // 0-9
    result.push(String.fromCharCode(48 + (squareLat % 10)));  // 0-9
  }

  if (precision >= 6) {
    // Sub-square (5' x 2.5') - 6 characters
    const subLon = Math.floor(((lon % 2) / 5) * 24);
    const subLat = Math.floor(((lat % 1) / 2.5) * 24);
    result.push(String.fromCharCode(97 + (subLon % 24))); // a-x
    result.push(String.fromCharCode(97 + (subLat % 24))); // a-x
  }

  if (precision >= 8) {
    // Extended (30" x 15") - 8 characters
    const extLon = Math.floor((((lon % (2/60)) / (30/3600)) * 10));
    const extLat = Math.floor((((lat % (1/60)) / (15/3600)) * 10));
    result.push(String.fromCharCode(48 + (extLon % 10))); // 0-9
    result.push(String.fromCharCode(48 + (extLat % 10)));  // 0-9
  }

  return result.slice(0, precision).join('');
}

/**
 * Calculate the bounding box for a Maidenhead grid square
 *
 * @param {string} grid - Maidenhead grid square
 * @returns {object} {minLat, maxLat, minLon, maxLon} or null if invalid
 */
export function maidenheadToBounds(grid) {
  if (!grid || grid.length < 2) return null;

  // Normalize to uppercase
  grid = grid.toUpperCase().substring(0, 8);

  let minLon, maxLon, minLat, maxLat;

  // Field boundaries (20° x 10°)
  const fieldLon = grid.charCodeAt(0) - 65;
  const fieldLat = grid.charCodeAt(1) - 65;
  minLon = fieldLon * 20 - 180;
  maxLon = minLon + 20;
  minLat = fieldLat * 10 - 90;
  maxLat = minLat + 10;

  // Square boundaries (2° x 1°)
  if (grid.length >= 4 && /^\d\d$/.test(grid.substring(2, 4))) {
    const squareLon = parseInt(grid[2], 10);
    const squareLat = parseInt(grid[3], 10);
    minLon = fieldLon * 20 + squareLon * 2;
    maxLon = minLon + 2;
    minLat = fieldLat * 10 + squareLat;
    maxLat = minLat + 1;
  }

  // Sub-square boundaries (5' x 2.5')
  if (grid.length >= 6) {
    const subLon = grid.charCodeAt(4) - 97;
    const subLat = grid.charCodeAt(5) - 97;
    if (subLon >= 0 && subLon < 24 && subLat >= 0 && subLat < 24) {
      minLon = fieldLon * 20 + (parseInt(grid[2], 10) || 0) * 2 + subLon * (5 / 60);
      maxLon = minLon + (5 / 60);
      minLat = fieldLat * 10 + (parseInt(grid[3], 10) || 0) + subLat * (2.5 / 60);
      maxLat = minLat + (2.5 / 60);
    }
  }

  // Extended boundaries (30" x 15")
  if (grid.length >= 8) {
    const extLon = parseInt(grid[6], 10);
    const extLat = parseInt(grid[7], 10);
    if (Number.isFinite(extLon) && Number.isFinite(extLat)) {
      const prevMinLon = minLon;
      const prevMinLat = minLat;
      minLon = prevMinLon + extLon * (30 / 3600);
      maxLon = minLon + (30 / 3600);
      minLat = prevMinLat + extLat * (15 / 3600);
      maxLat = minLat + (15 / 3600);
    }
  }

  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Determine which grid levels to display based on zoom level
 *
 * @param {number} zoom - Current map zoom level
 * @returns {object} Which grid levels to show
 */
export function getGridLevelsForZoom(zoom) {
  // Leaflet zoom levels typically range from 0 (world) to 18 (street)
  // Adjust thresholds based on desired appearance

  return {
    fields: zoom >= 1,      // Always show fields
    squares: zoom >= 3,     // Show squares at zoom 3+
    subSquares: zoom >= 6,  // Show sub-squares at zoom 6+
    extended: zoom >= 9,    // Show extended at zoom 9+
    labels: zoom >= 4,     // Show labels at zoom 4+
  };
}

/**
 * Calculate grid lines for the visible viewport
 *
 * @param {object} bounds - Leaflet bounds {south, north, west, east}
 * @param {number} precision - Grid precision level
 * @returns {object} Grid lines and labels
 */
export function calculateGridForBounds(bounds, precision) {
  const lines = [];
  const labels = [];

  const south = Math.max(-90, bounds.south);
  const north = Math.min(90, bounds.north);
  const west = ((bounds.west + 180) % 360 + 360) % 360;
  const east = ((bounds.east + 180) % 360 + 360) % 360;

  // Calculate grid boundaries based on precision
  let lonStep, latStep;
  let lonSubStep, latSubStep;

  switch (precision) {
    case 2: // Fields only
      lonStep = 20;
      latStep = 10;
      break;
    case 4: // Squares
      lonStep = 2;
      latStep = 1;
      lonSubStep = 20;
      latSubStep = 10;
      break;
    case 6: // Sub-squares
      lonStep = 2;
      latStep = 1;
      lonSubStep = 5 / 60;  // 5 minutes
      latSubStep = 2.5 / 60; // 2.5 minutes
      break;
    case 8: // Extended
      lonStep = 2;
      latStep = 1;
      lonSubStep = 5 / 60;
      latSubStep = 2.5 / 60;
      break;
    default:
      lonStep = 2;
      latStep = 1;
  }

  // Generate longitude lines
  const startLon = Math.floor(west / lonStep) * lonStep;
  const endLon = Math.ceil(east / lonStep) * lonStep;

  for (let lon = startLon; lon <= endLon; lon += lonStep) {
    const normalizedLon = ((lon + 180) % 360 + 360) % 360 - 180;
    if (normalizedLon > -180 && normalizedLon < 180) {
      lines.push({
        type: 'vertical',
        value: normalizedLon,
        from: south,
        to: north,
      });
    }
  }

  // Generate latitude lines
  const startLat = Math.floor(south / latStep) * latStep;
  const endLat = Math.ceil(north / latStep) * latStep;

  for (let lat = startLat; lat <= endLat; lat += latStep) {
    if (lat > -90 && lat < 90) {
      lines.push({
        type: 'horizontal',
        value: lat,
        from: west,
        to: east,
      });
    }
  }

  // Add sub-square lines if precision >= 6 and zoom is sufficient
  if (precision >= 6) {
    const subStartLon = Math.floor(west / lonSubStep) * lonSubStep;
    const subEndLon = Math.ceil(east / lonSubStep) * lonSubStep;
    const subStartLat = Math.floor(south / latSubStep) * latSubStep;
    const subEndLat = Math.ceil(north / latSubStep) * latSubStep;

    for (let lon = subStartLon; lon <= subEndLon; lon += lonSubStep) {
      const normalizedLon = ((lon + 180) % 360 + 360) % 360 - 180;
      if (normalizedLon > -180 && normalizedLon < 180 && lon % lonStep !== 0) {
        lines.push({
          type: 'vertical',
          value: normalizedLon,
          from: south,
          to: north,
          minor: true,
        });
      }
    }

    for (let lat = subStartLat; lat <= subEndLat; lat += latSubStep) {
      if (lat > -90 && lat < 90 && lat % latStep !== 0) {
        lines.push({
          type: 'horizontal',
          value: lat,
          from: west,
          to: east,
          minor: true,
        });
      }
    }
  }

  // Generate grid labels (center of each field/square)
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

// Canvas layer component for Maidenhead grid
function MaidenheadCanvasLayer({ map, enabled, opacity, precision, showLabels }) {
  const canvasRef = useRef(null);
  const layerRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Draw the grid on canvas
  const drawGrid = useCallback(() => {
    if (!map || !canvasRef.current || !enabled) return;

    const L = window.L;
    if (!L) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const bounds = map.getBounds();

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (opacity <= 0) return;

    // Set styles
    const majorColor = `rgba(255, 180, 50, ${opacity * 0.8})`;
    const minorColor = `rgba(255, 180, 50, ${opacity * 0.4})`;
    const labelColor = `rgba(255, 255, 255, ${opacity})`;

    // Get grid levels based on zoom
    const zoom = map.getZoom();
    const gridLevels = getGridLevelsForZoom(zoom);

    // Calculate which precision levels to show
    let displayPrecision = precision;
    if (precision >= 4 && !gridLevels.squares) displayPrecision = 2;
    if (precision >= 6 && !gridLevels.subSquares) displayPrecision = 4;
    if (precision >= 8 && !gridLevels.extended) displayPrecision = 6;

    // Calculate grid lines
    const gridData = calculateGridForBounds(
      { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() },
      displayPrecision
    );

    // Draw lines
    ctx.lineWidth = 1;

    gridData.lines.forEach((line) => {
      const color = line.minor ? minorColor : majorColor;
      ctx.strokeStyle = color;

      const p1 = map.latLngToContainerPoint([line.from, line.value]);
      const p2 = map.latLngToContainerPoint([line.to, line.value]);

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    });

    // Draw labels if enabled and zoom is sufficient
    if (showLabels && gridLevels.labels && precision >= 2) {
      ctx.font = `${Math.max(10, 12 - zoom * 0.5)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = labelColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Filter labels to avoid overcrowding at low zoom
      const labelFilter = precision >= 6 ? 1 : precision >= 4 ? 2 : 4;
      let labelCount = 0;

      gridData.labels.forEach((label, index) => {
        if (labelCount % labelFilter === 0) {
          const point = map.latLngToContainerPoint([label.lat, label.lon]);
          // Only draw if within visible canvas
          if (point.x > 0 && point.x < canvas.width && point.y > 0 && point.y < canvas.height) {
            // Add background for readability
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

  // Initialize and manage canvas layer
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    const L = window.L;

    // Create canvas if needed
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.style.cssText = 'position: absolute; top: 0; left: 0; pointer-events: none; z-index: 400;';
    }

    // Create Leaflet canvas layer
    const CanvasLayer = L.Layer.extend({
      onAdd: function (map) {
        const pane = map.getPane('overlayPane');
        pane.appendChild(canvasRef.current);
        this._resizeCanvas();
        this._frame = L.DomUtil.create('div', 'leaflet-grids-layer', pane);
        map.on('moveend', this._redraw, this);
        map.on('zoomend', this._redraw, this);
        this._redraw();
      },
      onRemove: function (map) {
        map.off('moveend', this._redraw, this);
        map.off('zoomend', this._redraw, this);
        if (canvasRef.current && canvasRef.current.parentNode) {
          canvasRef.current.parentNode.removeChild(canvasRef.current);
        }
      },
      _resizeCanvas: function () {
        const size = map.getSize();
        canvasRef.current.width = size.x;
        canvasRef.current.height = size.y;
      },
      _redraw: function () {
        if (!enabled) {
          if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          }
          return;
        }
        this._resizeCanvas();
        drawGrid();
      },
    });

    layerRef.current = new CanvasLayer();
    layerRef.current.addTo(map);

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [map, enabled]);

  // Update canvas when opacity or precision changes
  useEffect(() => {
    if (enabled && layerRef.current && map) {
      drawGrid();
    }
  }, [opacity, precision, showLabels, enabled, drawGrid, map]);

  return null;
}

// Main plugin hook
export function useLayer({ map, enabled, opacity, config }) {
  const [precision, setPrecision] = useState(4);
  const [showLabels, setShowLabels] = useState(true);
  const controlRef = useRef(null);

  // Use refs to track current values for control panel updates
  const precisionRef = useRef(precision);
  const showLabelsRef = useRef(showLabels);

  // Update refs when state changes
  useEffect(() => {
    precisionRef.current = precision;
    showLabelsRef.current = showLabels;

    // Update control panel if it exists
    const precisionSelect = document.getElementById('maidenhead-precision-select');
    const labelsCheckbox = document.getElementById('maidenhead-labels-checkbox');
    if (precisionSelect) {
      precisionSelect.value = precision;
    }
    if (labelsCheckbox) {
      labelsCheckbox.checked = showLabels;
    }
  }, [precision, showLabels]);

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

  // Create control panel for grid settings
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    const L = window.L;

    // Create custom control for grid settings
    const MaidenheadGridControl = L.Control.extend({
      options: {
        position: 'topright',
      },
      onAdd: function () {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control maidenhead-grid-control');
        container.style.background = 'rgba(0,0,0,0.8)';
        container.style.padding = '8px';
        container.style.borderRadius = '4px';
        container.style.minWidth = '140px';
        container.style.fontFamily = "'JetBrains Mono', monospace";

        const precisionOptions = [
          { value: 2, label: 'Fields (AB)' },
          { value: 4, label: 'Squares (AB12)' },
          { value: 6, label: 'Sub-sq (AB12cd)' },
          { value: 8, label: 'Extended (AB12cd34)' },
        ];

        // Use refs to get current values
        const currentPrecision = precisionRef.current;
        const currentShowLabels = showLabelsRef.current;

        const precisionSelect = precisionOptions
          .map((opt) => `<option value="${opt.value}" ${opt.value === currentPrecision ? 'selected' : ''}>${opt.label}</option>`)
          .join('');

        container.innerHTML = `
          <div style="margin-bottom: 8px;">
            <label style="color: #aaa; font-size: 10px; display: block; margin-bottom: 4px;">Grid Precision</label>
            <select id="maidenhead-precision-select" style="
              width: 100%; padding: 4px;
              background: rgba(0,0,0,0.5); color: #fff;
              border: 1px solid #555; border-radius: 4px;
              font-family: 'JetBrains Mono', monospace; font-size: 11px;
            ">${precisionSelect}</select>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="maidenhead-labels-checkbox" ${currentShowLabels ? 'checked' : ''}
              style="cursor: pointer;">
            <label for="maidenhead-labels-checkbox" style="color: #aaa; font-size: 11px; cursor: pointer;">
              Show Labels
            </label>
          </div>
          <div style="color: #666; font-size: 9px; margin-top: 8px; text-align: center;">
            ⊞ Maidenhead Grid
          </div>
        `;

        return container;
      },
    });

    // Add control to map
    controlRef.current = new MaidenheadGridControl();
    map.addControl(controlRef.current);

    // Wire up event handlers after DOM is ready
    setTimeout(() => {
      const container = controlRef.current?._container;
      if (!container) return;

      // Apply saved position
      const savedPosition = localStorage.getItem('maidenhead-grid-control-position');
      if (savedPosition) {
        try {
          const { top, right, bottom, left } = JSON.parse(savedPosition);
          container.style.position = 'fixed';
          if (top !== undefined) container.style.top = top + 'px';
          if (right !== undefined) container.style.right = right + 'px';
          if (bottom !== undefined) container.style.bottom = bottom + 'px';
          if (left !== undefined) container.style.left = left + 'px';
        } catch (e) {
          // Ignore parse errors
        }
      }

      // Make control draggable
      let isDragging = false;
      let startX, startY, startTop, startRight, startBottom, startLeft;

      container.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startTop = container.offsetTop;
        startRight = container.offsetRight;
        startBottom = container.offsetBottom;
        startLeft = container.offsetLeft;
        container.style.transition = 'none';
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (container.style.top) container.style.top = Math.max(0, startTop + dy) + 'px';
        if (container.style.left) container.style.left = Math.max(0, startLeft + dx) + 'px';
      });

      document.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          container.style.transition = '';
          try {
            localStorage.setItem(
              'maidenhead-grid-control-position',
              JSON.stringify({
                top: container.offsetTop,
                left: container.offsetLeft,
              })
            );
          } catch (e) {
            // Ignore storage errors
          }
        }
      });

      const precisionSelect = document.getElementById('maidenhead-precision-select');
      const labelsCheckbox = document.getElementById('maidenhead-labels-checkbox');

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

    return () => {
      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
    };
  }, [map]);

  // Render canvas layer
  return (
    <MaidenheadCanvasLayer
      map={map}
      enabled={enabled}
      opacity={opacity}
      precision={precision}
      showLabels={showLabels}
    />
  );
}

// Export additional API functions for external control
export { getGridLevelsForZoom, calculateGridForBounds };

// Default export for plugin system
export default { metadata, useLayer };

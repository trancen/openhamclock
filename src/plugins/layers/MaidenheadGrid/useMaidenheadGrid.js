/**
 * Maidenhead Grid Overlay Plugin
 */
import { useState } from 'react';
import { useEffect, useRef, useCallback } from 'react';

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

  // Sub-square lines
  if (precision >= 6) {
    const subLonStep = 5 / 60;
    const subLatStep = 2.5 / 60;
    for (let lon = Math.floor(west / subLonStep) * subLonStep; lon <= Math.ceil(east / subLonStep) * subLonStep; lon += subLonStep) {
      const nLon = ((lon + 180) % 360 + 360) % 360 - 180;
      if (nLon > -180 && nLon < 180 && lon % lonStep !== 0) {
        lines.push({ type: 'vertical', value: nLon, from: south, to: north, minor: true });
      }
    }
    for (let lat = Math.floor(south / subLatStep) * subLatStep; lat <= Math.ceil(north / subLatStep) * subLatStep; lat += subLatStep) {
      if (lat > -90 && lat < 90 && lat % latStep !== 0) {
        lines.push({ type: 'horizontal', value: lat, from: west, to: east, minor: true });
      }
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

export function useLayer({ map, enabled, opacity }) {
  // TEMPORARILY COMMENTED OUT TO DEBUG
  // if (typeof window === 'undefined' || !window.L) {
  //   return null;
  // }
  //
  // const [precision, setPrecision] = useState(4);
  // const [showLabels, setShowLabels] = useState(true);
  // const canvasRef = useRef(null);
  //
  // // Load saved preferences
  // useEffect(() => {
  //   const savedPrecision = localStorage.getItem('maidenhead-grid-precision');
  //   const savedLabels = localStorage.getItem('maidenhead-grid-labels');
  //
  //   if (savedPrecision) {
  //     const parsed = parseInt(savedPrecision, 10);
  //     if ([2, 4, 6, 8].includes(parsed)) {
  //       setPrecision(parsed);
  //     }
  //   }
  //
  //   if (savedLabels !== null) {
  //     setShowLabels(savedLabels !== 'false');
  //   }
  // }, []);
  //
  // // Draw grid function
  // const drawGrid = useCallback(() => {
  //   if (!map || !canvasRef.current || !enabled) return;
  //
  //   const L = window.L;
  //   if (!L) return;
  //
  //   const canvas = canvasRef.current;
  //   const ctx = canvas.getContext('2d');
  //   const bounds = map.getBounds();
  //
  //   ctx.clearRect(0, 0, canvas.width, canvas.height);
  //
  //   if (opacity <= 0) return;
  //
  //   const majorColor = 'rgba(255, 180, 50, ' + (opacity * 0.8) + ')';
  //   const minorColor = 'rgba(255, 180, 50, ' + (opacity * 0.4) + ')';
  //   const labelColor = 'rgba(255, 255, 255, ' + opacity + ')';
  //
  //   const zoom = map.getZoom();
  //   const gridLevels = getGridLevelsForZoom(zoom);
  //
  //   let displayPrecision = precision;
  //   if (precision >= 4 && !gridLevels.squares) displayPrecision = 2;
  //   if (precision >= 6 && !gridLevels.subSquares) displayPrecision = 4;
  //
  //   const gridData = calculateGridForBounds(
  //     { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() },
  //     displayPrecision
  //   );
  //
  //   ctx.lineWidth = 1;
  //
  //   gridData.lines.forEach(function(line) {
  //     ctx.strokeStyle = line.minor ? minorColor : majorColor;
  //     const p1 = map.latLngToContainerPoint([line.from, line.value]);
  //     const p2 = map.latLngToContainerPoint([line.to, line.value]);
  //     ctx.beginPath();
  //     ctx.moveTo(p1.x, p1.y);
  //     ctx.lineTo(p2.x, p2.y);
  //     ctx.stroke();
  //   });
  //
  //   if (showLabels && gridLevels.labels) {
  //     ctx.font = Math.max(10, 12 - zoom * 0.5) + 'px monospace';
  //     ctx.fillStyle = labelColor;
  //     ctx.textAlign = 'center';
  //     ctx.textBaseline = 'middle';
  //
  //     const labelFilter = precision >= 6 ? 1 : precision >= 4 ? 2 : 4;
  //     let labelCount = 0;
  //
  //     gridData.labels.forEach(function(label) {
  //       if (labelCount % labelFilter === 0) {
  //         const point = map.latLngToContainerPoint([label.lat, label.lon]);
  //         if (point.x > 0 && point.x < canvas.width && point.y > 0 && point.y < canvas.height) {
  //           const textWidth = ctx.measureText(label.text).width;
  //           ctx.fillStyle = 'rgba(0, 0, 0, ' + (opacity * 0.5) + ')';
  //           ctx.fillRect(point.x - textWidth / 2 - 2, point.y - 7, textWidth + 4, 14);
  //           ctx.fillStyle = labelColor;
  //           ctx.fillText(label.text, point.x, point.y);
  //           labelCount++;
  //         }
  //       }
  //     });
  //   }
  // }, [map, enabled, opacity, precision, showLabels]);
  //
  // // Initialize canvas
  // useEffect(function() {
  //   if (!map || typeof L === 'undefined') return;
  //
  //   const L = window.L;
  //   const CanvasLayer = L.Layer.extend({
  //     onAdd: function(m) {
  //       const pane = m.getPane('overlayPane');
  //       if (!canvasRef.current) {
  //         canvasRef.current = document.createElement('canvas');
  //         canvasRef.current.style.cssText = 'position: absolute; top: 0; left: 0; pointer-events: none; z-index: 400;';
  //       }
  //       pane.appendChild(canvasRef.current);
  //       this.resizeCanvas(m);
  //       m.on('moveend', this.redraw, this);
  //       m.on('zoomend', this.redraw, this);
  //       this.redraw();
  //     },
  //     onRemove: function(m) {
  //       m.off('moveend', this.redraw, this);
  //       m.off('zoomend', this.redraw, this);
  //       if (canvasRef.current && canvasRef.current.parentNode) {
  //         canvasRef.current.parentNode.removeChild(canvasRef.current);
  //       }
  //     },
  //     resizeCanvas: function(m) {
  //       if (canvasRef.current) {
  //         const size = m.getSize();
  //         canvasRef.current.width = size.x;
  //         canvasRef.current.height = size.y;
  //       }
  //     },
  //     redraw: function() {
  //       if (enabled && canvasRef.current) {
  //         this.resizeCanvas(map);
  //         drawGrid();
  //       }
  //     },
  //   });
  //
  //   const layer = new CanvasLayer();
  //   layer.addTo(map);
  //
  //   return function() {
  //     map.removeLayer(layer);
  //   };
  // }, [map, drawGrid, enabled]);
  //
  // // Update on changes
  // useEffect(function() {
  //   if (enabled && canvasRef.current && map) {
  //     drawGrid();
  //   }
  // }, [enabled, opacity, precision, showLabels, drawGrid, map]);

  return null;
}

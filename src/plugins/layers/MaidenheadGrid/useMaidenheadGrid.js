/**
 * Maidenhead Grid Overlay Plugin
 * Based on: https://github.com/ha8tks/Leaflet.Maidenhead
 */
import { useState, useEffect, useRef } from 'react';

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

// Grid unit sizes per zoom level
var d3 = [20,10,10,10,10,10,1,1,1,1,1/24,1/24,1/24,1/24,1/24,1/240,1/240,1/240,1/240/24,1/240/24,1/240/24];
var lat_cor = [0,8,8,8,10,14,6,8,8,8,1.4,2.5,3,3.5,4,4,3.5,3.5,1.47,1.8,1.6];
var title_size = [0,10,12,16,20,26,12,16,24,36,12,14,20,36,60,12,20,36,8,12,24];

// Convert lat/lon to Maidenhead grid square - EXACTLY like reference
function getMaidenheadGrid(lon, lat, precision) {
  var ydiv_arr = [10, 1, 1/24, 1/240, 1/240/24];
  var d1 = "ABCDEFGHIJKLMNOPQR".split("");
  var d2 = "ABCDEFGHIJKLMNOPQRSTUVWX".split("");
  var d4 = [0,1,1,1,1,1,2,2,2,2,3,3,3,3,3,4,4,4,5,5,5];
  
  var locator = "";
  var x = lon;
  var y = lat;
  var p = d4[Math.round(precision)] || 1;
  
  console.log('DEBUG getMaidenheadGrid: lon=' + lon + ', lat=' + lat + ', precision=' + precision + ', p=' + p);
  
  while (x < -180) { x += 360; }
  while (x > 180) { x -= 360; }
  
  x = x + 180;
  y = y + 90;
  
  locator = locator + d1[Math.floor(x / 20)] + d1[Math.floor(y / 10)];
  
  console.log('DEBUG: After field, locator=' + locator);
  
  for (var i = 0; i < 4; i++) {
    if (p > i + 1) {
      var rlon = x % (ydiv_arr[i] * 2);
      var rlat = y % (ydiv_arr[i]);
      console.log('DEBUG: i=' + i + ', rlon=' + rlon + ', rlat=' + rlat + ', ydiv_arr[i+1]=' + ydiv_arr[i+1]);
      if ((i % 2) == 0) {
        var added = Math.floor(rlon/(ydiv_arr[i+1]*2)) + "" + Math.floor(rlat/(ydiv_arr[i+1]));
        console.log('DEBUG: i even, adding digits: ' + added);
        locator += added;
      } else {
        var added = d2[Math.floor(rlon/(ydiv_arr[i+1]*2))] + "" + d2[Math.floor(rlat/(ydiv_arr[i+1]))];
        console.log('DEBUG: i odd, adding letters: ' + added);
        locator += added;
      }
    }
  }
  
  console.log('DEBUG: Final locator=' + locator);
  return locator;
}

// Determine precision based on zoom
function getPrecisionForZoom(zoom) {
  console.log('DEBUG getPrecisionForZoom: zoom=' + zoom);
  // Zoom 0-3: 2 chars (fields only)
  // Zoom 4-7: 4 chars (fields + squares)  
  // Zoom 8+: 6 chars (fields + squares + subsquares)
  if (zoom <= 3) return 1;
  if (zoom <= 7) return 2;
  return 3;
}

// Main plugin hook
export function useLayer({ map, enabled, opacity }) {
  const [precision, setPrecision] = useState(4);
  const [showLabels, setShowLabels] = useState(true);
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

  // Create and manage the Leaflet layer
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;
    if (!enabled) return;

    var gridLayer = L.layerGroup();
    
    var redrawGrid = function() {
      gridLayer.clearLayers();
      
      var bounds = map.getBounds();
      var zoom = map.getZoom();
      var p = getPrecisionForZoom(zoom);
      
      console.log('DEBUG: zoom=' + zoom + ', p=' + p);
      
      var unit = d3[Math.round(zoom)];
      var lcor = lat_cor[Math.round(zoom)];
      
      // Handle lcor = 0 (at zoom 0)
      if (lcor === 0) lcor = 8;
      
      var w = bounds.getWest();
      var e = bounds.getEast();
      var n = bounds.getNorth();
      var s = bounds.getSouth();
      
      var c = (zoom === 1) ? 2 : 0.1;
      if (n > 85) n = 85;
      if (s < -85) s = -85;
      
      var left = Math.floor(w / (unit * 2)) * (unit * 2);
      var right = Math.ceil(e / (unit * 2)) * (unit * 2);
      var top = Math.ceil(n / unit) * unit;
      var bottom = Math.floor(s / unit) * unit;
      
      console.log('DEBUG: left=' + left + ', right=' + right + ', top=' + top + ', bottom=' + bottom + ', unit=' + unit);
      
      for (var lon = left; lon < right; lon += (unit * 2)) {
        for (var lat = bottom; lat < top; lat += unit) {
          var rectBounds = [[lat, lon], [lat + unit, lon + (unit * 2)]];
          
          // Add rectangle
          gridLayer.addLayer(L.rectangle(rectBounds, {
            color: '#FFB432',
            weight: 1,
            fill: false,
            opacity: opacity * 0.7,
            interactive: false
          }));
          
          // Add label - CENTER of the grid cell
          if (showLabels) {
            // Simply center in the cell
            var labelLon = lon + unit;
            var labelLat = lat + unit / 2;
            var gridSquare = getMaidenheadGrid(labelLon, labelLat, zoom);
            
            console.log('DEBUG: label at lon=' + labelLon + ', lat=' + labelLat + ' = ' + gridSquare);
            
            var size = (title_size[Math.round(zoom)] || 12) + 'px';
            
            var myIcon = L.divIcon({
              className: 'my-div-icon',
              html: '<span style="color: white; font-size: ' + size + '; font-family: monospace; font-weight: bold; text-shadow: 1px 1px 2px black;">' + gridSquare + '</span>',
              iconSize: [80, 30],
              iconAnchor: [40, 15]
            });
            
            gridLayer.addLayer(L.marker([labelLat, labelLon], {
              icon: myIcon,
              clickable: false
            }));
          }
        }
      }
    };

    // Initial draw
    redrawGrid();
    gridLayer.addTo(map);
    layerRef.current = gridLayer;

    // Redraw on map move/zoom
    map.on('moveend', redrawGrid);
    map.on('zoomend', redrawGrid);

    return () => {
      map.off('moveend', redrawGrid);
      map.off('zoomend', redrawGrid);
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, enabled, precision, showLabels, opacity]);

  return null;
}

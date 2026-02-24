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

// Convert lat/lon to Maidenhead grid square
function getMaidenheadGrid(lon, lat, zoom) {
  var ydiv_arr = [10, 1, 1/24, 1/240, 1/240/24];
  var d1 = "ABCDEFGHIJKLMNOPQR".split("");
  var d2 = "ABCDEFGHIJKLMNOPQRSTUVWX".split("");
  // Precision mapping: zoom level -> how many pairs of chars
  var d4 = [0,1,1,1,1,1,2,2,2,2,3,3,3,3,3,4,4,4,5,5,5];
  
  var locator = "";
  var x = lon;
  var y = lat;
  var p = d4[Math.round(zoom)] || 1;
  
  while (x < -180) { x += 360; }
  while (x > 180) { x -= 360; }
  
  x = x + 180;
  y = y + 90;
  
  locator = locator + d1[Math.floor(x / 20)] + d1[Math.floor(y / 10)];
  
  for (var i = 0; i < 4; i++) {
    if (p > i + 1) {
      var rlon = x % (ydiv_arr[i] * 2);
      var rlat = y % (ydiv_arr[i]);
      if ((i % 2) == 0) {
        locator += Math.floor(rlon/(ydiv_arr[i+1]*2)) + "" + Math.floor(rlat/(ydiv_arr[i+1]));
      } else {
        locator += d2[Math.floor(rlon/(ydiv_arr[i+1]*2))] + "" + d2[Math.floor(rlat/(ydiv_arr[i+1]))];
      }
    }
  }
  
  return locator;
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

    // Grid unit sizes per zoom level (d3[zoom])
    var d3 = [20,10,10,10,10,10,1,1,1,1,1/24,1/24,1/24,1/24,1/24,1/240,1/240,1/240,1/240/24,1/240/24,1/240/24];
    var lat_cor = [0,8,8,8,10,14,6,8,8,8,1.4,2.5,3,3.5,4,4,3.5,3.5,1.47,1.8,1.6];
    // Font sizes per zoom level
    var title_size = [0,10,12,16,20,26,12,16,24,36,12,14,20,36,60,12,20,36,8,12,24];
    
    var gridLayer = L.layerGroup();
    
    var redrawGrid = function() {
      gridLayer.clearLayers();
      
      var bounds = map.getBounds();
      var zoom = map.getZoom();
      var unit = d3[Math.round(zoom)];
      var lcor = lat_cor[Math.round(zoom)];
      
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
          
          // Add label - using exact formula from reference
          if (showLabels) {
            var labelLon = lon + unit; // Center of cell
            var labelLat = lat + unit / 2; // Center of cell
            var gridSquare = getMaidenheadGrid(labelLon, labelLat, zoom);
            
            var fontSize = title_size[Math.round(zoom)] || 12;
            
            var myIcon = L.divIcon({
              className: 'maidenhead-label',
              html: '<span style="color: rgba(255,255,255,' + opacity + '); font-size: ' + fontSize + 'px; font-family: monospace; font-weight: bold; text-shadow: 1px 1px 2px black; white-space: nowrap;">' + gridSquare + '</span>',
              iconSize: [fontSize * 6, fontSize * 1.8],
              iconAnchor: [fontSize * 3, fontSize * 0.9]
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

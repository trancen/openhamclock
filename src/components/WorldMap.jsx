/**
 * WorldMap Component
 * Leaflet map with DE/DX markers, terminator, DX paths, POTA, satellites, PSKReporter
 */
import React, { useRef, useEffect, useState } from 'react';
import { MAP_STYLES } from '../utils/config.js';
import { 
  calculateGridSquare, 
  getSunPosition, 
  getMoonPosition, 
  getGreatCirclePoints 
} from '../utils/geo.js';
import { filterDXPaths, getBandColor } from '../utils/callsign.js';

import { getAllLayers } from '../plugins/layerRegistry.js';
import PluginLayer from './PluginLayer.jsx';


export const WorldMap = ({ 
  deLocation, 
  dxLocation, 
  onDXChange, 
  potaSpots, 
  mySpots, 
  dxPaths, 
  dxFilters, 
  satellites, 
  pskReporterSpots,
  showDXPaths, 
  showDXLabels, 
  onToggleDXLabels, 
  showPOTA, 
  showSatellites, 
  showPSKReporter,
  onToggleSatellites, 
  hoveredSpot 
}) => {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const terminatorRef = useRef(null);
  const deMarkerRef = useRef(null);
  const dxMarkerRef = useRef(null);
  const sunMarkerRef = useRef(null);
  const moonMarkerRef = useRef(null);
  const potaMarkersRef = useRef([]);
  const mySpotsMarkersRef = useRef([]);
  const mySpotsLinesRef = useRef([]);
  const dxPathsLinesRef = useRef([]);
  const dxPathsMarkersRef = useRef([]);
  const satMarkersRef = useRef([]);
  const satTracksRef = useRef([]);
  const pskMarkersRef = useRef([]);

  // Plugin system refs and state
  const pluginLayersRef = useRef({});
  const [pluginLayerStates, setPluginLayerStates] = useState({});
  
  // Load map style from localStorage
  const getStoredMapSettings = () => {
    try {
      const stored = localStorage.getItem('openhamclock_mapSettings');
      return stored ? JSON.parse(stored) : {};
    } catch (e) { return {}; }
  };
  const storedSettings = getStoredMapSettings();
  
  const [mapStyle, setMapStyle] = useState(storedSettings.mapStyle || 'dark');
  const [mapView, setMapView] = useState({
    center: storedSettings.center || [20, 0],
    zoom: storedSettings.zoom || 2.5
  });
  
  // Save map settings to localStorage when changed
  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_mapSettings', JSON.stringify({
        mapStyle,
        center: mapView.center,
        zoom: mapView.zoom
      }));
    } catch (e) { console.error('Failed to save map settings:', e); }
  }, [mapStyle, mapView]);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    
    // Make sure Leaflet is available
    if (typeof L === 'undefined') {
      console.error('Leaflet not loaded');
      return;
    }

    const map = L.map(mapRef.current, {
      center: mapView.center,
      zoom: mapView.zoom,
      minZoom: 1,
      maxZoom: 18,
      worldCopyJump: true,
      zoomControl: true,
      maxBounds: [[-90, -Infinity], [90, Infinity]],
      maxBoundsViscosity: 0.8
    });

    // Initial tile layer
    tileLayerRef.current = L.tileLayer(MAP_STYLES[mapStyle].url, {
      attribution: MAP_STYLES[mapStyle].attribution,
      noWrap: false,
      crossOrigin: 'anonymous',
      bounds: [[-85, -180], [85, 180]]
    }).addTo(map);

    // Day/night terminator
    terminatorRef.current = L.terminator({
      resolution: 2,
      fillOpacity: 0.35,
      fillColor: '#000020',
      color: '#ffaa00',
      weight: 2,
      dashArray: '5, 5'
    }).addTo(map);

    // Refresh terminator
    setTimeout(() => {
      if (terminatorRef.current) {
        terminatorRef.current.setTime();
      }
    }, 100);

    // Update terminator every minute
    const terminatorInterval = setInterval(() => {
      if (terminatorRef.current) {
        terminatorRef.current.setTime();
      }
    }, 60000);

    // Click handler for setting DX
    map.on('click', (e) => {
      if (onDXChange) {
        onDXChange({ lat: e.latlng.lat, lon: e.latlng.lng });
      }
    });
    
    // Save map view when user pans or zooms
    map.on('moveend', () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      setMapView({ center: [center.lat, center.lng], zoom });
    });

    mapInstanceRef.current = map;

    return () => {
      clearInterval(terminatorInterval);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update tile layer when style changes
  useEffect(() => {
    if (!mapInstanceRef.current || !tileLayerRef.current) return;
    
    mapInstanceRef.current.removeLayer(tileLayerRef.current);
    tileLayerRef.current = L.tileLayer(MAP_STYLES[mapStyle].url, {
      attribution: MAP_STYLES[mapStyle].attribution,
      noWrap: false,
      crossOrigin: 'anonymous',
      bounds: [[-85, -180], [85, 180]]
    }).addTo(mapInstanceRef.current);
    
    // Ensure terminator is on top
    if (terminatorRef.current) {
      terminatorRef.current.bringToFront();
    }
  }, [mapStyle]);

  // Update DE/DX markers and celestial bodies
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Remove old markers
    if (deMarkerRef.current) map.removeLayer(deMarkerRef.current);
    if (dxMarkerRef.current) map.removeLayer(dxMarkerRef.current);
    if (sunMarkerRef.current) map.removeLayer(sunMarkerRef.current);
    if (moonMarkerRef.current) map.removeLayer(moonMarkerRef.current);

    // DE Marker
    const deIcon = L.divIcon({
      className: 'custom-marker de-marker',
      html: 'DE',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    deMarkerRef.current = L.marker([deLocation.lat, deLocation.lon], { icon: deIcon })
      .bindPopup(`<b>DE - Your Location</b><br>${calculateGridSquare(deLocation.lat, deLocation.lon)}<br>${deLocation.lat.toFixed(4)}°, ${deLocation.lon.toFixed(4)}°`)
      .addTo(map);

    // DX Marker
    const dxIcon = L.divIcon({
      className: 'custom-marker dx-marker',
      html: 'DX',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    dxMarkerRef.current = L.marker([dxLocation.lat, dxLocation.lon], { icon: dxIcon })
      .bindPopup(`<b>DX - Target</b><br>${calculateGridSquare(dxLocation.lat, dxLocation.lon)}<br>${dxLocation.lat.toFixed(4)}°, ${dxLocation.lon.toFixed(4)}°`)
      .addTo(map);

    // Sun marker
    const sunPos = getSunPosition(new Date());
    const sunIcon = L.divIcon({
      className: 'custom-marker sun-marker',
      html: '☀',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    sunMarkerRef.current = L.marker([sunPos.lat, sunPos.lon], { icon: sunIcon })
      .bindPopup(`<b>☀ Subsolar Point</b><br>${sunPos.lat.toFixed(2)}°, ${sunPos.lon.toFixed(2)}°`)
      .addTo(map);

    // Moon marker
    const moonPos = getMoonPosition(new Date());
    const moonIcon = L.divIcon({
      className: 'custom-marker moon-marker',
      html: '🌙',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    moonMarkerRef.current = L.marker([moonPos.lat, moonPos.lon], { icon: moonIcon })
      .bindPopup(`<b>🌙 Sublunar Point</b><br>${moonPos.lat.toFixed(2)}°, ${moonPos.lon.toFixed(2)}°`)
      .addTo(map);
  }, [deLocation, dxLocation]);

  // Update DX paths
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Remove old DX paths
    dxPathsLinesRef.current.forEach(l => map.removeLayer(l));
    dxPathsLinesRef.current = [];
    dxPathsMarkersRef.current.forEach(m => map.removeLayer(m));
    dxPathsMarkersRef.current = [];

    // Add new DX paths if enabled
    if (showDXPaths && dxPaths && dxPaths.length > 0) {
      const filteredPaths = filterDXPaths(dxPaths, dxFilters);
      
      filteredPaths.forEach((path) => {
        try {
          if (!path.spotterLat || !path.spotterLon || !path.dxLat || !path.dxLon) return;
          if (isNaN(path.spotterLat) || isNaN(path.spotterLon) || isNaN(path.dxLat) || isNaN(path.dxLon)) return;
          
          const pathPoints = getGreatCirclePoints(
            path.spotterLat, path.spotterLon,
            path.dxLat, path.dxLon
          );
          
          if (!pathPoints || !Array.isArray(pathPoints) || pathPoints.length === 0) return;
          
          const freq = parseFloat(path.freq);
          const color = getBandColor(freq);
          
          const isHovered = hoveredSpot && hoveredSpot.call === path.dxCall && 
                           Math.abs(parseFloat(hoveredSpot.freq) - parseFloat(path.freq)) < 0.01;
          
          // Handle path rendering (single continuous array, unwrapped across antimeridian)
          if (pathPoints && Array.isArray(pathPoints) && pathPoints.length > 1) {
            const line = L.polyline(pathPoints, {
              color: isHovered ? '#ffffff' : color,
              weight: isHovered ? 4 : 1.5,
              opacity: isHovered ? 1 : 0.5
            }).addTo(map);
            if (isHovered) line.bringToFront();
            dxPathsLinesRef.current.push(line);
          }

          // Use unwrapped endpoint so marker sits where the line ends
          const endPoint = pathPoints[pathPoints.length - 1];
          const dxLatDisplay = endPoint[0];
          const dxLonDisplay = endPoint[1];

          // Add DX marker
          const dxCircle = L.circleMarker([dxLatDisplay, dxLonDisplay], {
            radius: isHovered ? 10 : 6,
            fillColor: isHovered ? '#ffffff' : color,
            color: isHovered ? color : '#fff',
            weight: isHovered ? 3 : 1.5,
            opacity: 1,
            fillOpacity: isHovered ? 1 : 0.9
          })
            .bindPopup(`<b style="color: ${color}">${path.dxCall}</b><br>${path.freq} MHz<br>by ${path.spotter}`)
            .addTo(map);
          if (isHovered) dxCircle.bringToFront();
          dxPathsMarkersRef.current.push(dxCircle);
          
          // Add label if enabled
          if (showDXLabels || isHovered) {
            const labelIcon = L.divIcon({
              className: '',
              html: `<span style="display:inline-block;background:${isHovered ? '#fff' : color};color:${isHovered ? color : '#000'};padding:4px 8px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;white-space:nowrap;border:2px solid ${isHovered ? color : 'rgba(0,0,0,0.5)'};box-shadow:0 2px 4px rgba(0,0,0,0.4);">${path.dxCall}</span>`,
              iconSize: null,
              iconAnchor: [0, 0]
            });
            const label = L.marker([dxLatDisplay, dxLonDisplay], { icon: labelIcon, interactive: false }).addTo(map);
            dxPathsMarkersRef.current.push(label);
          }
        } catch (err) {
          console.error('Error rendering DX path:', err);
        }
      });
    }
  }, [dxPaths, dxFilters, showDXPaths, showDXLabels, hoveredSpot]);

  // Update POTA markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    potaMarkersRef.current.forEach(m => map.removeLayer(m));
    potaMarkersRef.current = [];

    if (showPOTA && potaSpots) {
      potaSpots.forEach(spot => {
        if (spot.lat && spot.lon) {
          const icon = L.divIcon({
            className: '',
            html: `<span style="display:inline-block;background:#aa66ff;color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;font-family:'JetBrains Mono',monospace;font-weight:700;white-space:nowrap;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.4);">${spot.call}</span>`,
            iconSize: null,
            iconAnchor: [0, 0]
          });
          const marker = L.marker([spot.lat, spot.lon], { icon })
            .bindPopup(`<b>${spot.call}</b><br>${spot.ref}<br>${spot.freq} ${spot.mode}`)
            .addTo(map);
          potaMarkersRef.current.push(marker);
        }
      });
    }
  }, [potaSpots, showPOTA]);

  // Update satellite markers with orbit tracks
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    satMarkersRef.current.forEach(m => map.removeLayer(m));
    satMarkersRef.current = [];
    satTracksRef.current.forEach(t => map.removeLayer(t));
    satTracksRef.current = [];

    if (showSatellites && satellites && satellites.length > 0) {
      satellites.forEach(sat => {
        const satColor = sat.color || '#00ffff';
        const satColorDark = sat.visible ? satColor : '#446666';
        
        // Draw orbit track if available
        if (sat.track && sat.track.length > 1) {
          // Unwrap longitudes for continuous rendering across antimeridian
          const unwrapped = sat.track.map(p => [...p]);
          for (let i = 1; i < unwrapped.length; i++) {
            while (unwrapped[i][1] - unwrapped[i-1][1] > 180) unwrapped[i][1] -= 360;
            while (unwrapped[i][1] - unwrapped[i-1][1] < -180) unwrapped[i][1] += 360;
          }
          
          const trackLine = L.polyline(unwrapped, {
            color: sat.visible ? satColor : satColorDark,
            weight: 2,
            opacity: sat.visible ? 0.8 : 0.4,
            dashArray: sat.visible ? null : '5, 5'
          }).addTo(map);
          satTracksRef.current.push(trackLine);
        }
        
        // Draw footprint circle if available and satellite is visible
        if (sat.footprintRadius && sat.lat && sat.lon && sat.visible) {
          const footprint = L.circle([sat.lat, sat.lon], {
            radius: sat.footprintRadius * 1000, // Convert km to meters
            color: satColor,
            weight: 1,
            opacity: 0.5,
            fillColor: satColor,
            fillOpacity: 0.1
          }).addTo(map);
          satTracksRef.current.push(footprint);
        }
        
        // Add satellite marker icon
        const icon = L.divIcon({
          className: '',
          html: `<span style="display:inline-block;background:${sat.visible ? satColor : satColorDark};color:${sat.visible ? '#000' : '#fff'};padding:4px 8px;border-radius:4px;font-size:11px;font-family:'JetBrains Mono',monospace;white-space:nowrap;border:2px solid ${sat.visible ? '#fff' : '#666'};font-weight:bold;box-shadow:0 2px 4px rgba(0,0,0,0.4);">🛰 ${sat.name}</span>`,
          iconSize: null,
          iconAnchor: [0, 0]
        });
        
        const marker = L.marker([sat.lat, sat.lon], { icon })
          .bindPopup(`
            <b>🛰 ${sat.name}</b><br>
            <table style="font-size: 11px;">
              <tr><td>Mode:</td><td><b>${sat.mode || 'Unknown'}</b></td></tr>
              <tr><td>Alt:</td><td>${sat.alt} km</td></tr>
              <tr><td>Az:</td><td>${sat.azimuth}°</td></tr>
              <tr><td>El:</td><td>${sat.elevation}°</td></tr>
              <tr><td>Range:</td><td>${sat.range} km</td></tr>
              <tr><td>Status:</td><td>${sat.visible ? '<span style="color:green">✓ Visible</span>' : '<span style="color:gray">Below horizon</span>'}</td></tr>
            </table>
          `)
          .addTo(map);
        satMarkersRef.current.push(marker);
      });
    }
  }, [satellites, showSatellites]);

  // Plugin layer system - properly load saved states
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    try {
      const availableLayers = getAllLayers();
      const settings = getStoredMapSettings();
      const savedLayers = settings.layers || {};

      // Build initial states from localStorage
      const initialStates = {};
      availableLayers.forEach(layerDef => {
        // Use saved state if it exists, otherwise use defaults
        if (savedLayers[layerDef.id]) {
          initialStates[layerDef.id] = savedLayers[layerDef.id];
        } else {
          initialStates[layerDef.id] = {
            enabled: layerDef.defaultEnabled,
            opacity: layerDef.defaultOpacity
          };
        }
      });

      // Initialize state ONLY on first mount (when empty)
      if (Object.keys(pluginLayerStates).length === 0) {
        console.log('Loading saved layer states:', initialStates);
        setPluginLayerStates(initialStates);
      }

      // Expose controls for SettingsPanel
      window.hamclockLayerControls = {
        layers: availableLayers.map(l => ({
          ...l,
          enabled: pluginLayerStates[l.id]?.enabled ?? initialStates[l.id]?.enabled ?? l.defaultEnabled,
          opacity: pluginLayerStates[l.id]?.opacity ?? initialStates[l.id]?.opacity ?? l.defaultOpacity
        })),
        toggleLayer: (id, enabled) => {
          console.log(`Toggle layer ${id}:`, enabled);
          const settings = getStoredMapSettings();
          const layers = settings.layers || {};
          layers[id] = { 
            enabled: enabled,
            opacity: layers[id]?.opacity ?? 0.6
          };
          localStorage.setItem('openhamclock_mapSettings', JSON.stringify({ ...settings, layers }));
          console.log('Saved to localStorage:', layers);
          setPluginLayerStates(prev => ({ 
            ...prev, 
            [id]: { 
              ...prev[id], 
              enabled: enabled 
            } 
          }));
        },
        setOpacity: (id, opacity) => {
          console.log(`Set opacity ${id}:`, opacity);
          const settings = getStoredMapSettings();
          const layers = settings.layers || {};
          layers[id] = { 
            enabled: layers[id]?.enabled ?? false,
            opacity: opacity
          };
          localStorage.setItem('openhamclock_mapSettings', JSON.stringify({ ...settings, layers }));
          console.log('Saved to localStorage:', layers);
          setPluginLayerStates(prev => ({ 
            ...prev, 
            [id]: { 
              ...prev[id], 
              opacity: opacity 
            } 
          }));
        }
      };
    } catch (err) {
      console.error('Plugin system error:', err);
    }
  }, [pluginLayerStates]);

  // Update PSKReporter markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    pskMarkersRef.current.forEach(m => map.removeLayer(m));
    pskMarkersRef.current = [];

    // Validate deLocation exists and has valid coordinates
    const hasValidDE = deLocation && 
      typeof deLocation.lat === 'number' && !isNaN(deLocation.lat) &&
      typeof deLocation.lon === 'number' && !isNaN(deLocation.lon);

    if (showPSKReporter && pskReporterSpots && pskReporterSpots.length > 0 && hasValidDE) {
      pskReporterSpots.forEach(spot => {
        // Validate spot coordinates are valid numbers
        let spotLat = parseFloat(spot.lat);
        let spotLon = parseFloat(spot.lon);
        
        if (!isNaN(spotLat) && !isNaN(spotLon)) {
          const displayCall = spot.receiver || spot.sender;
          const freqMHz = spot.freqMHz || (spot.freq ? (spot.freq / 1000000).toFixed(3) : '?');
          const bandColor = getBandColor(parseFloat(freqMHz));
          
          try {
            // Draw line from DE to spot location
            const points = getGreatCirclePoints(
              deLocation.lat, deLocation.lon,
              spotLat, spotLon,
              50
            );
            
            // Validate points before creating polyline (single continuous array, unwrapped across antimeridian)
            if (points && Array.isArray(points) && points.length > 1 && 
                points.every(p => Array.isArray(p) && !isNaN(p[0]) && !isNaN(p[1]))) {
              const line = L.polyline(points, {
                color: bandColor,
                weight: 1.5,
                opacity: 0.5,
                dashArray: '4, 4'
              }).addTo(map);
              pskMarkersRef.current.push(line);
              
              // Use unwrapped endpoint so dot sits where the line ends
              const endPoint = points[points.length - 1];
              spotLat = endPoint[0];
              spotLon = endPoint[1];
            }
            
            // Add small dot marker at spot location
            const circle = L.circleMarker([spotLat, spotLon], {
              radius: 4,
              fillColor: bandColor,
              color: '#fff',
              weight: 1,
              opacity: 0.9,
              fillOpacity: 0.8
            }).bindPopup(`
              <b>${displayCall}</b><br>
              ${spot.mode} @ ${freqMHz} MHz<br>
              ${spot.snr !== null ? `SNR: ${spot.snr > 0 ? '+' : ''}${spot.snr} dB` : ''}
            `).addTo(map);
            pskMarkersRef.current.push(circle);
          } catch (err) {
            console.warn('Error rendering PSKReporter spot:', err);
          }
        }
      });
    }
  }, [pskReporterSpots, showPSKReporter, deLocation]);

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: '200px' }}>
      <div ref={mapRef} style={{ height: '100%', width: '100%', borderRadius: '8px' }} />
      
      {/* Render all plugin layers */}
      {mapInstanceRef.current && getAllLayers().map(layerDef => (
        <PluginLayer
          key={layerDef.id}
          plugin={layerDef}
          enabled={pluginLayerStates[layerDef.id]?.enabled || false}
          opacity={pluginLayerStates[layerDef.id]?.opacity || layerDef.defaultOpacity}
          map={mapInstanceRef.current}
        />
      ))}
      
      {/* Map style dropdown */}
      <select
        value={mapStyle}
        onChange={(e) => setMapStyle(e.target.value)}
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'rgba(0, 0, 0, 0.8)',
          border: '1px solid #444',
          color: '#00ffcc',
          padding: '6px 10px',
          borderRadius: '4px',
          fontSize: '11px',
          fontFamily: 'JetBrains Mono',
          cursor: 'pointer',
          zIndex: 1000,
          outline: 'none'
        }}
      >
        {Object.entries(MAP_STYLES).map(([key, style]) => (
          <option key={key} value={key}>{style.name}</option>
        ))}
      </select>
      
      {/* Satellite toggle */}
      {onToggleSatellites && (
        <button
          onClick={onToggleSatellites}
          style={{
            position: 'absolute',
            top: '10px',
            left: '50px',
            background: showSatellites ? 'rgba(0, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.8)',
            border: `1px solid ${showSatellites ? '#00ffff' : '#666'}`,
            color: showSatellites ? '#00ffff' : '#888',
            padding: '6px 10px',
            borderRadius: '4px',
            fontSize: '11px',
            fontFamily: 'JetBrains Mono',
            cursor: 'pointer',
            zIndex: 1000
          }}
        >
          🛰 SAT {showSatellites ? 'ON' : 'OFF'}
        </button>
      )}
      
      {/* Labels toggle */}
      {onToggleDXLabels && showDXPaths && (
        <button
          onClick={onToggleDXLabels}
          style={{
            position: 'absolute',
            top: '10px',
            left: '145px',
            background: showDXLabels ? 'rgba(255, 170, 0, 0.2)' : 'rgba(0, 0, 0, 0.8)',
            border: `1px solid ${showDXLabels ? '#ffaa00' : '#666'}`,
            color: showDXLabels ? '#ffaa00' : '#888',
            padding: '6px 10px',
            borderRadius: '4px',
            fontSize: '11px',
            fontFamily: 'JetBrains Mono',
            cursor: 'pointer',
            zIndex: 1000
          }}
        >
          🏷️ CALLS {showDXLabels ? 'ON' : 'OFF'}
        </button>
      )}
      
      {/* Legend */}
      <div style={{
        position: 'absolute',
        bottom: '8px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0, 0, 0, 0.85)',
        border: '1px solid #444',
        borderRadius: '6px',
        padding: '8px 14px',
        zIndex: 1000,
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
        fontSize: '12px',
        fontFamily: 'JetBrains Mono, monospace'
      }}>
        {showDXPaths && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ color: '#888' }}>DX:</span>
            <span style={{ background: '#ff6666', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>160m</span>
            <span style={{ background: '#ff9966', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>80m</span>
            <span style={{ background: '#ffcc66', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>40m</span>
            <span style={{ background: '#ccff66', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>30m</span>
            <span style={{ background: '#66ff99', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>20m</span>
            <span style={{ background: '#66ffcc', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>17m</span>
            <span style={{ background: '#66ccff', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>15m</span>
            <span style={{ background: '#6699ff', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>12m</span>
            <span style={{ background: '#9966ff', color: '#fff', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>10m</span>
            <span style={{ background: '#cc66ff', color: '#fff', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>6m</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ background: '#00aaff', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>● DE</span>
          <span style={{ background: '#ff8800', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>● DX</span>
        </div>
        {showPOTA && (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ background: '#aa66ff', color: '#fff', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>● POTA</span>
          </div>
        )}
        {showSatellites && (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ background: '#00ffff', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>🛰 SAT</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span style={{ color: '#ffcc00' }}>☀ Sun</span>
          <span style={{ color: '#aaaaaa' }}>🌙 Moon</span>
        </div>
      </div>
    </div>
  );
};


export default WorldMap;

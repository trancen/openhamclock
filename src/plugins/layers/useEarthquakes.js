import { useState, useEffect, useRef } from 'react';

//Scaled markers - Bigger circles for stronger quakes
//Color-coded by magnitude:
//Yellow: M2.5-3 (minor)
//Orange: M3-4 (light)
//Deep Orange: M4-5 (moderate)
//Red: M5-6 (strong)
//Dark Red: M6-7 (major)
//Very Dark Red: M7+ (great)

export const metadata = {
  id: 'earthquakes',
  name: 'Earthquakes',
  description: 'Live USGS earthquake data (M2.5+ from last 24 hours) with animated detection',
  icon: '🌋',
  category: 'geology',
  defaultEnabled: false,
  defaultOpacity: 0.9,
  version: '1.1.0'
};

export function useLayer({ enabled = false, opacity = 0.9, map = null }) {
  const [markersRef, setMarkersRef] = useState([]);
  const [earthquakeData, setEarthquakeData] = useState([]);
  const previousQuakeIds = useRef(new Set());

  // Fetch earthquake data
  useEffect(() => {
    if (!enabled) return;

    const fetchEarthquakes = async () => {
      try {
        // USGS GeoJSON feed - M2.5+ from last day
        const response = await fetch(
          'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'
        );
        const data = await response.json();
        setEarthquakeData(data.features || []);
      } catch (err) {
        console.error('Earthquake data fetch error:', err);
      }
    };

    fetchEarthquakes();
    // Refresh every 5 minutes
    const interval = setInterval(fetchEarthquakes, 300000);

    return () => clearInterval(interval);
  }, [enabled]);

  // Add/remove markers with animation for new quakes
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // Clear old markers
    markersRef.forEach(marker => {
      try {
        map.removeLayer(marker);
      } catch (e) {
        // Already removed
      }
    });
    setMarkersRef([]);

    if (!enabled || earthquakeData.length === 0) return;

    const newMarkers = [];
    const currentQuakeIds = new Set();

    earthquakeData.forEach(quake => {
      const coords = quake.geometry.coordinates;
      const props = quake.properties;
      const mag = props.mag;
      const lat = coords[1];
      const lon = coords[0];
      const depth = coords[2];
      const quakeId = quake.id;

      currentQuakeIds.add(quakeId);

      // Skip if invalid coordinates
      if (!lat || !lon || isNaN(lat) || isNaN(lon)) return;

      // Check if this is a new earthquake
      const isNew = !previousQuakeIds.current.has(quakeId);

      // Calculate marker size based on magnitude (M2.5 = 8px, M7+ = 40px)
      const size = Math.min(Math.max(mag * 4, 8), 40);

      // Color based on magnitude
      let color;
      if (mag < 3) color = '#ffff00'; // Yellow - minor
      else if (mag < 4) color = '#ffaa00'; // Orange - light
      else if (mag < 5) color = '#ff6600'; // Deep orange - moderate
      else if (mag < 6) color = '#ff3300'; // Red - strong
      else if (mag < 7) color = '#cc0000'; // Dark red - major
      else color = '#990000'; // Very dark red - great

      // Create circle marker with animation class if new
      const circle = L.circleMarker([lat, lon], {
        radius: size / 2,
        fillColor: color,
        color: '#fff',
        weight: 2,
        opacity: opacity,
        fillOpacity: opacity * 0.7,
        className: isNew ? 'earthquake-pulse-new' : 'earthquake-marker'
      });

      // Add pulsing animation for new earthquakes
      if (isNew) {
        // Create pulsing ring effect
        const pulseRing = L.circle([lat, lon], {
          radius: 50000, // 50km radius in meters
          fillColor: color,
          fillOpacity: 0,
          color: color,
          weight: 3,
          opacity: 0.8,
          className: 'earthquake-pulse-ring'
        });
        
        pulseRing.addTo(map);
        
        // Remove pulse ring after animation completes
        setTimeout(() => {
          try {
            map.removeLayer(pulseRing);
          } catch (e) {}
        }, 3000);
      }

      // Format time
      const time = new Date(props.time);
      const timeStr = time.toLocaleString();
      const ageMinutes = Math.floor((Date.now() - props.time) / 60000);
      const ageStr = ageMinutes < 60 
        ? `${ageMinutes} min ago` 
        : `${Math.floor(ageMinutes / 60)} hr ago`;

      // Add popup with details
      circle.bindPopup(`
        <div style="font-family: 'JetBrains Mono', monospace; min-width: 200px;">
          <div style="font-size: 16px; font-weight: bold; color: ${color}; margin-bottom: 8px;">
            ${isNew ? '🆕 ' : ''}M${mag.toFixed(1)} ${props.type === 'earthquake' ? '🌋' : '⚡'}
          </div>
          <table style="font-size: 12px; width: 100%;">
            <tr><td><b>Location:</b></td><td>${props.place || 'Unknown'}</td></tr>
            <tr><td><b>Time:</b></td><td>${timeStr}</td></tr>
            <tr><td><b>Age:</b></td><td>${ageStr}</td></tr>
            <tr><td><b>Depth:</b></td><td>${depth.toFixed(1)} km</td></tr>
            <tr><td><b>Magnitude:</b></td><td>${mag.toFixed(1)}</td></tr>
            <tr><td><b>Status:</b></td><td>${props.status || 'automatic'}</td></tr>
            ${props.tsunami ? '<tr><td colspan="2" style="color: red; font-weight: bold;">⚠️ TSUNAMI WARNING</td></tr>' : ''}
          </table>
          ${props.url ? `<a href="${props.url}" target="_blank" style="color: #00aaff; font-size: 11px;">View Details →</a>` : ''}
        </div>
      `);

      circle.addTo(map);
      newMarkers.push(circle);
    });

    // Update previous quake IDs for next comparison
    previousQuakeIds.current = currentQuakeIds;

    setMarkersRef(newMarkers);

    return () => {
      newMarkers.forEach(marker => {
        try {
          map.removeLayer(marker);
        } catch (e) {
          // Already removed
        }
      });
    };
  }, [enabled, earthquakeData, map, opacity]);

  return {
    markers: markersRef,
    earthquakeCount: earthquakeData.length
  };
}

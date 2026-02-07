import { useState, useEffect, useRef } from 'react';

/**
 * Gray Line Propagation Overlay Plugin v1.0.1
 * 
 * Features:
 * - Real-time solar terminator (day/night boundary)
 * - Twilight zones (civil, nautical, astronomical)
 * - Animated update every minute
 * - Enhanced propagation zone highlighting
 * - Color-coded by propagation potential
 * - Minimizable control panel
 * - Corrected sine wave calculation (v1.0.1)
 * 
 * Use Case: Identify optimal times for long-distance DX contacts
 * The gray line provides enhanced HF propagation for several hours
 */

export const metadata = {
  id: 'grayline',
  name: 'plugins.layers.grayline.name',
  description: 'plugins.layers.grayline.description',
  icon: '🌅',
  category: 'propagation',
  defaultEnabled: false,
  defaultOpacity: 0.5,
  version: '1.0.2'
};

// Solar calculations based on astronomical algorithms
function calculateSolarPosition(date) {
  const JD = dateToJulianDate(date);
  const T = (JD - 2451545.0) / 36525.0; // Julian centuries since J2000.0
  
  // Mean longitude of the sun
  const L0 = (280.46646 + 36000.76983 * T + 0.0003032 * T * T) % 360;
  
  // Mean anomaly
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) % 360;
  const MRad = M * Math.PI / 180;
  
  // Equation of center
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(MRad)
          + (0.019993 - 0.000101 * T) * Math.sin(2 * MRad)
          + 0.000289 * Math.sin(3 * MRad);
  
  // True longitude
  const trueLon = L0 + C;
  
  // Apparent longitude
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLon - 0.00569 - 0.00478 * Math.sin(omega * Math.PI / 180);
  
  // Obliquity of ecliptic
  const epsilon = 23.439291 - 0.0130042 * T;
  const epsilonRad = epsilon * Math.PI / 180;
  const lambdaRad = lambda * Math.PI / 180;
  
  // Solar declination
  const declination = Math.asin(Math.sin(epsilonRad) * Math.sin(lambdaRad)) * 180 / Math.PI;
  
  // Solar right ascension
  const RA = Math.atan2(Math.cos(epsilonRad) * Math.sin(lambdaRad), Math.cos(lambdaRad)) * 180 / Math.PI;
  
  return { declination, rightAscension: RA };
}

function dateToJulianDate(date) {
  return (date.getTime() / 86400000) + 2440587.5;
}

// Calculate solar hour angle for a given longitude at a specific time
function calculateHourAngle(date, longitude) {
  const JD = dateToJulianDate(date);
  const T = (JD - 2451545.0) / 36525.0;
  
  // Greenwich Mean Sidereal Time
  const GMST = (280.46061837 + 360.98564736629 * (JD - 2451545.0) + 0.000387933 * T * T - T * T * T / 38710000) % 360;
  
  const { rightAscension } = calculateSolarPosition(date);
  
  // Local hour angle
  const hourAngle = (GMST + longitude - rightAscension + 360) % 360;
  
  return hourAngle;
}

// Calculate solar altitude for a given position and time
function calculateSolarAltitude(date, latitude, longitude) {
  const { declination } = calculateSolarPosition(date);
  const hourAngle = calculateHourAngle(date, longitude);
  
  const latRad = latitude * Math.PI / 180;
  const decRad = declination * Math.PI / 180;
  const haRad = hourAngle * Math.PI / 180;
  
  const sinAlt = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  const altitude = Math.asin(sinAlt) * 180 / Math.PI;
  
  return altitude;
}

// Split polyline at date line to avoid lines cutting across the map
function splitAtDateLine(points) {
  if (points.length < 2) return [points];
  
  // Check if line spans the full world (-180 to 180)
  const lons = points.map(p => p[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const span = maxLon - minLon;
  
  // If the line spans close to 360°, it wraps around the world
  // We need to split it at the ±180° boundary
  if (span > 350) {
    // Strategy: Create two segments that meet at ±180° longitude
    // Segment 1: Western hemisphere (-180° to slightly past 0°)
    // Segment 2: Eastern hemisphere (slightly before 0° to +180°)
    
    const westSegment = [];  // Points from -180° to ~0°
    const eastSegment = [];  // Points from ~0° to +180°
    
    // Sort points by longitude to ensure correct ordering
    const sortedPoints = [...points].sort((a, b) => a[1] - b[1]);
    
    // Find the midpoint longitude (should be around 0°)
    const midIndex = Math.floor(sortedPoints.length / 2);
    
    // Split at midpoint, with some overlap
    westSegment.push(...sortedPoints.slice(0, midIndex + 1));
    eastSegment.push(...sortedPoints.slice(midIndex));
    
    const segments = [];
    if (westSegment.length >= 2) segments.push(westSegment);
    if (eastSegment.length >= 2) segments.push(eastSegment);
    
    return segments;
  }
  
  // Otherwise, check for sudden longitude jumps (traditional date line crossing)
  const segments = [];
  let currentSegment = [points[0]];
  
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const prevLon = prev[1];
    const currLon = curr[1];
    const lonDiff = Math.abs(currLon - prevLon);
    
    // If longitude jumps more than 180°, we've crossed the date line
    if (lonDiff > 180) {
      segments.push(currentSegment);
      currentSegment = [curr];
    } else {
      currentSegment.push(curr);
    }
  }
  
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }
  
  return segments.filter(seg => seg.length >= 2);
}

// Generate terminator line for a specific solar altitude
function generateTerminatorLine(date, solarAltitude = 0, numPoints = 360) {
  const points = [];
  const { declination } = calculateSolarPosition(date);
  const decRad = declination * Math.PI / 180;
  const altRad = solarAltitude * Math.PI / 180;
  
  // For each longitude, calculate the latitude where the sun is at the specified altitude
  for (let i = 0; i <= numPoints; i++) {
    const lon = (i / numPoints) * 360 - 180;
    const hourAngle = calculateHourAngle(date, lon);
    const haRad = hourAngle * Math.PI / 180;
    
    const cosHA = Math.cos(haRad);
    const sinDec = Math.sin(decRad);
    const cosDec = Math.cos(decRad);
    const sinAlt = Math.sin(altRad);
    
    let lat;
    
    // Check if solution exists (sun can reach this altitude at this longitude)
    // For terminator and twilight, check if |cos(HA) * cos(dec)| <= 1 - sin(alt) * sin(dec)
    const testValue = (sinAlt - sinDec * sinDec) / (cosDec * cosDec * cosHA * cosHA);
    
    if (Math.abs(declination) < 0.01) {
      // Near equinox: terminator is nearly straight along equator
      lat = 0;
    } else if (Math.abs(cosDec) < 0.001) {
      // Near solstice: sun is directly over tropic, skip this point
      continue;
    } else {
      // Standard case: calculate terminator latitude
      const tanDec = Math.tan(decRad);
      
      if (solarAltitude === 0) {
        // Terminator (sunrise/sunset line)
        // Formula: tan(lat) = -cos(HA) / tan(dec)
        if (Math.abs(tanDec) > 0.0001) {
          lat = Math.atan(-cosHA / tanDec) * 180 / Math.PI;
        } else {
          lat = 0;
        }
      } else {
        // Twilight zones (negative solar altitude)
        // Use Newton-Raphson iteration to solve for latitude
        // Equation: sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(HA) = sin(alt)
        
        // Initial guess based on terminator
        let testLat = Math.atan(-cosHA / tanDec);
        
        // Iterate to find solution
        let converged = false;
        for (let iter = 0; iter < 10; iter++) {
          const f = Math.sin(testLat) * sinDec + Math.cos(testLat) * cosDec * cosHA - sinAlt;
          const fPrime = Math.cos(testLat) * sinDec - Math.sin(testLat) * cosDec * cosHA;
          
          if (Math.abs(f) < 0.0001) {
            converged = true;
            break;
          }
          
          if (Math.abs(fPrime) > 0.0001) {
            testLat = testLat - f / fPrime;
          } else {
            break;
          }
          
          // Constrain to valid latitude range during iteration
          testLat = Math.max(-Math.PI/2, Math.min(Math.PI/2, testLat));
        }
        
        // Only use the point if iteration converged
        if (!converged) {
          continue;
        }
        
        lat = testLat * 180 / Math.PI;
      }
    }
    
    // Strict clamping to valid latitude range
    lat = Math.max(-85, Math.min(85, lat));
    
    // Only add point if it's valid and not at extreme latitude
    if (isFinite(lat) && isFinite(lon) && Math.abs(lat) < 85) {
      points.push([lat, lon]);
    }
  }
  
  return points;
}

// Make control panel draggable and minimizable
function makeDraggable(element, storageKey) {
  if (!element) return;
  
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    try {
      const { top, left } = JSON.parse(saved);
      element.style.position = 'fixed';
      element.style.top = top + 'px';
      element.style.left = left + 'px';
      element.style.right = 'auto';
      element.style.bottom = 'auto';
    } catch (e) {}
  } else {
    const rect = element.getBoundingClientRect();
    element.style.position = 'fixed';
    element.style.top = rect.top + 'px';
    element.style.left = rect.left + 'px';
    element.style.right = 'auto';
    element.style.bottom = 'auto';
  }
  
  element.title = 'Hold CTRL and drag to reposition';
  
  let isDragging = false;
  let startX, startY, startLeft, startTop;
  
  const updateCursor = (e) => {
    if (e.ctrlKey) {
      element.style.cursor = 'grab';
    } else {
      element.style.cursor = 'default';
    }
  };
  
  element.addEventListener('mouseenter', updateCursor);
  element.addEventListener('mousemove', updateCursor);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Control') updateCursor(e);
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Control') updateCursor(e);
  });
  
  element.addEventListener('mousedown', function(e) {
    if (!e.ctrlKey) return;
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') {
      return;
    }
    
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = element.offsetLeft;
    startTop = element.offsetTop;
    
    element.style.cursor = 'grabbing';
    element.style.opacity = '0.8';
    e.preventDefault();
  });
  
  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    element.style.left = (startLeft + dx) + 'px';
    element.style.top = (startTop + dy) + 'px';
  });
  
  document.addEventListener('mouseup', function(e) {
    if (isDragging) {
      isDragging = false;
      element.style.opacity = '1';
      updateCursor(e);
      
      localStorage.setItem(storageKey, JSON.stringify({
        top: element.offsetTop,
        left: element.offsetLeft
      }));
    }
  });
}

function addMinimizeToggle(element, storageKey) {
  if (!element) return;
  
  const minimizeKey = storageKey + '-minimized';
  const header = element.querySelector('div:first-child');
  if (!header) return;
  
  const content = Array.from(element.children).slice(1);
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'grayline-panel-content';
  content.forEach(child => contentWrapper.appendChild(child));
  element.appendChild(contentWrapper);
  
  const minimizeBtn = document.createElement('span');
  minimizeBtn.className = 'grayline-minimize-btn';
  minimizeBtn.innerHTML = '▼';
  minimizeBtn.style.cssText = `
    float: right;
    cursor: pointer;
    user-select: none;
    padding: 0 4px;
    margin: -2px -4px 0 0;
    font-size: 10px;
    opacity: 0.7;
    transition: opacity 0.2s;
  `;
  minimizeBtn.title = 'Minimize/Maximize';
  
  minimizeBtn.addEventListener('mouseenter', () => {
    minimizeBtn.style.opacity = '1';
  });
  minimizeBtn.addEventListener('mouseleave', () => {
    minimizeBtn.style.opacity = '0.7';
  });
  
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.appendChild(minimizeBtn);
  
  const isMinimized = localStorage.getItem(minimizeKey) === 'true';
  if (isMinimized) {
    contentWrapper.style.display = 'none';
    minimizeBtn.innerHTML = '▶';
    element.style.cursor = 'pointer';
  }
  
  const toggle = (e) => {
    if (e && e.ctrlKey) return;
    
    const isCurrentlyMinimized = contentWrapper.style.display === 'none';
    
    if (isCurrentlyMinimized) {
      contentWrapper.style.display = 'block';
      minimizeBtn.innerHTML = '▼';
      element.style.cursor = 'default';
      localStorage.setItem(minimizeKey, 'false');
    } else {
      contentWrapper.style.display = 'none';
      minimizeBtn.innerHTML = '▶';
      element.style.cursor = 'pointer';
      localStorage.setItem(minimizeKey, 'true');
    }
  };
  
  header.addEventListener('click', (e) => {
    if (e.target === header || e.target.tagName === 'DIV') {
      toggle(e);
    }
  });
  
  minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle(e);
  });
}

export function useLayer({ enabled = false, opacity = 0.5, map = null }) {
  const [layers, setLayers] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showTwilight, setShowTwilight] = useState(true);
  const [showEnhancedZone, setShowEnhancedZone] = useState(true);
  const [twilightOpacity, setTwilightOpacity] = useState(0.5);
  
  const controlRef = useRef(null);
  const updateIntervalRef = useRef(null);

  // Update time every minute
  useEffect(() => {
    if (!enabled) return;
    
    const updateTime = () => {
      setCurrentTime(new Date());
    };
    
    updateTime(); // Initial update
    updateIntervalRef.current = setInterval(updateTime, 60000); // Every minute
    
    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
    };
  }, [enabled]);

  // Create control panel
  useEffect(() => {
    if (!enabled || !map || controlRef.current) return;

    const GrayLineControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function() {
        const container = L.DomUtil.create('div', 'grayline-control');
        container.style.cssText = `
          background: var(--bg-panel);
          padding: 12px;
          border-radius: 5px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--text-primary);
          border: 1px solid var(--border-color);
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          min-width: 200px;
        `;
        
        const now = new Date();
        const timeStr = now.toUTCString();
        
        container.innerHTML = `
          <div style="font-weight: bold; margin-bottom: 8px; font-size: 12px;">🌅 Gray Line</div>
          
          <div style="margin-bottom: 8px; padding: 8px; background: var(--bg-tertiary); border-radius: 3px;">
            <div style="font-size: 9px; opacity: 0.7; margin-bottom: 2px;">UTC TIME</div>
            <div id="grayline-time" style="font-size: 10px; font-weight: bold;">${timeStr}</div>
          </div>
          
          <div style="margin-bottom: 8px;">
            <label style="display: flex; align-items: center; cursor: pointer;">
              <input type="checkbox" id="grayline-twilight" checked style="margin-right: 5px;" />
              <span>Show Twilight Zones</span>
            </label>
          </div>
          
          <div style="margin-bottom: 8px;">
            <label style="display: flex; align-items: center; cursor: pointer;">
              <input type="checkbox" id="grayline-enhanced" checked style="margin-right: 5px;" />
              <span>Enhanced DX Zone</span>
            </label>
          </div>
          
          <div style="margin-bottom: 8px;">
            <label style="display: block; margin-bottom: 3px;">Twilight Opacity: <span id="twilight-opacity-value">50</span>%</label>
            <input type="range" id="grayline-twilight-opacity" min="20" max="100" value="50" step="5" style="width: 100%;" />
          </div>
          
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #555; font-size: 9px; opacity: 0.7;">
            <div>🌅 Gray line = enhanced HF propagation</div>
            <div style="margin-top: 4px;">Updates every minute</div>
          </div>
        `;
        
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        
        return container;
      }
    });
    
    const control = new GrayLineControl();
    map.addControl(control);
    controlRef.current = control;
    
    setTimeout(() => {
      const container = document.querySelector('.grayline-control');
      if (container) {
        // Apply saved position IMMEDIATELY before making draggable
        const saved = localStorage.getItem('grayline-position');
        if (saved) {
          try {
            const { top, left } = JSON.parse(saved);
            container.style.position = 'fixed';
            container.style.top = top + 'px';
            container.style.left = left + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
          } catch (e) {}
        }
        
        makeDraggable(container, 'grayline-position');
        addMinimizeToggle(container, 'grayline-position');
      }
      
      // Add event listeners
      const twilightCheck = document.getElementById('grayline-twilight');
      const enhancedCheck = document.getElementById('grayline-enhanced');
      const twilightOpacitySlider = document.getElementById('grayline-twilight-opacity');
      const twilightOpacityValue = document.getElementById('twilight-opacity-value');
      
      if (twilightCheck) {
        twilightCheck.addEventListener('change', (e) => setShowTwilight(e.target.checked));
      }
      if (enhancedCheck) {
        enhancedCheck.addEventListener('change', (e) => setShowEnhancedZone(e.target.checked));
      }
      if (twilightOpacitySlider) {
        twilightOpacitySlider.addEventListener('input', (e) => {
          const value = parseInt(e.target.value) / 100;
          setTwilightOpacity(value);
          if (twilightOpacityValue) twilightOpacityValue.textContent = e.target.value;
        });
      }
    }, 150);
    
  }, [enabled, map]);

  // Update time display
  useEffect(() => {
    const timeElement = document.getElementById('grayline-time');
    if (timeElement && enabled) {
      timeElement.textContent = currentTime.toUTCString();
    }
  }, [currentTime, enabled]);

  // Render gray line and twilight zones
  useEffect(() => {
    if (!map || !enabled) return;

    // Clear old layers
    layers.forEach(layer => {
      try {
        map.removeLayer(layer);
      } catch (e) {}
    });
    
    const newLayers = [];
    
    // Main terminator (solar altitude = 0°)
    const terminator = generateTerminatorLine(currentTime, 0, 360);
    const terminatorSegments = splitAtDateLine(terminator);
    
    terminatorSegments.forEach(segment => {
      const terminatorLine = L.polyline(segment, {
        color: '#ff6600',
        weight: 3,
        opacity: opacity * 0.8,
        dashArray: '10, 5'
      });
      terminatorLine.bindPopup(`
        <div style="font-family: 'JetBrains Mono', monospace;">
          <b>🌅 Solar Terminator</b><br>
          Sun altitude: 0°<br>
          Enhanced HF propagation zone<br>
          UTC: ${currentTime.toUTCString()}
        </div>
      `);
      terminatorLine.addTo(map);
      newLayers.push(terminatorLine);
    });
    
    // Enhanced DX zone (±5° from terminator)
    if (showEnhancedZone) {
      const enhancedUpper = generateTerminatorLine(currentTime, 5, 360);
      const enhancedLower = generateTerminatorLine(currentTime, -5, 360);
      
      // Only create polygon if we have valid points
      if (enhancedUpper.length > 2 && enhancedLower.length > 2) {
        // Split both upper and lower lines at date line
        const upperSegments = splitAtDateLine(enhancedUpper);
        const lowerSegments = splitAtDateLine(enhancedLower);
        
        // Create polygon for each corresponding segment pair
        // Both upper and lower should have same number of segments
        const numSegments = Math.min(upperSegments.length, lowerSegments.length);
        
        for (let i = 0; i < numSegments; i++) {
          const upperSeg = upperSegments[i];
          const lowerSeg = lowerSegments[i];
          
          if (upperSeg.length > 1 && lowerSeg.length > 1) {
            // Create polygon from upper segment + reversed lower segment
            // This creates a closed shape between the two lines
            const enhancedZone = [...upperSeg, ...lowerSeg.slice().reverse()];
            
            const enhancedPoly = L.polygon(enhancedZone, {
              color: '#ffaa00',
              fillColor: '#ffaa00',
              fillOpacity: opacity * 0.15,
              weight: 1,
              opacity: opacity * 0.3
            });
            enhancedPoly.bindPopup(`
              <div style="font-family: 'JetBrains Mono', monospace;">
                <b>⭐ Enhanced DX Zone</b><br>
                Best HF propagation window<br>
                ±5° from terminator<br>
                Ideal for long-distance contacts
              </div>
            `);
            enhancedPoly.addTo(map);
            newLayers.push(enhancedPoly);
          }
        }
      }
    }
    
    // Twilight zones
    if (showTwilight) {
      // Civil twilight (sun altitude -6°)
      const civilTwilight = generateTerminatorLine(currentTime, -6, 360);
      const civilSegments = splitAtDateLine(civilTwilight);
      
      civilSegments.forEach(segment => {
        const civilLine = L.polyline(segment, {
          color: '#4488ff',
          weight: 2,
          opacity: twilightOpacity * 0.6,
          dashArray: '5, 5'
        });
        civilLine.bindPopup(`
          <div style="font-family: 'JetBrains Mono', monospace;">
            <b>🌆 Civil Twilight</b><br>
            Sun altitude: -6°<br>
            Good propagation conditions
          </div>
        `);
        civilLine.addTo(map);
        newLayers.push(civilLine);
      });
      
      // Nautical twilight (sun altitude -12°)
      const nauticalTwilight = generateTerminatorLine(currentTime, -12, 360);
      const nauticalSegments = splitAtDateLine(nauticalTwilight);
      
      nauticalSegments.forEach(segment => {
        const nauticalLine = L.polyline(segment, {
          color: '#6666ff',
          weight: 1.5,
          opacity: twilightOpacity * 0.4,
          dashArray: '3, 3'
        });
        nauticalLine.bindPopup(`
          <div style="font-family: 'JetBrains Mono', monospace;">
            <b>🌃 Nautical Twilight</b><br>
            Sun altitude: -12°<br>
            Moderate propagation
          </div>
        `);
        nauticalLine.addTo(map);
        newLayers.push(nauticalLine);
      });
      
      // Astronomical twilight (sun altitude -18°)
      const astroTwilight = generateTerminatorLine(currentTime, -18, 360);
      const astroSegments = splitAtDateLine(astroTwilight);
      
      astroSegments.forEach(segment => {
        const astroLine = L.polyline(segment, {
          color: '#8888ff',
          weight: 1,
          opacity: twilightOpacity * 0.3,
          dashArray: '2, 2'
        });
        astroLine.bindPopup(`
          <div style="font-family: 'JetBrains Mono', monospace;">
            <b>🌌 Astronomical Twilight</b><br>
            Sun altitude: -18°<br>
            Transition to night propagation
          </div>
        `);
        astroLine.addTo(map);
        newLayers.push(astroLine);
      });
    }
    
    setLayers(newLayers);
    
    return () => {
      newLayers.forEach(layer => {
        try {
          map.removeLayer(layer);
        } catch (e) {}
      });
    };
  }, [map, enabled, currentTime, opacity, showTwilight, showEnhancedZone, twilightOpacity]);

  // Cleanup on disable
  useEffect(() => {
    if (!enabled && map && controlRef.current) {
      try {
        map.removeControl(controlRef.current);
      } catch (e) {
        // Silently handle removal errors
      }
      controlRef.current = null;
      
      layers.forEach(layer => {
        try {
          map.removeLayer(layer);
        } catch (e) {}
      });
      setLayers([]);
    }
  }, [enabled, map, layers]);

  return {
    layers,
    currentTime,
    showTwilight,
    showEnhancedZone
  };
}

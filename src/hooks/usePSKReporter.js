/**
 * usePSKReporter Hook
 * Fetches PSKReporter data via HTTP API (primary/stable) with optional MQTT
 * 
 * Architecture Decision (Final):
 * - PRIMARY: HTTP API (retrieve.pskreporter.info) via server proxy
 * - OPTIONAL: MQTT (disabled by default due to connection instability)
 * 
 * Why HTTP-Only:
 * - Stable and reliable (no connection loops)
 * - Works on all sites (HTTP and HTTPS)
 * - Server-side caching reduces rate limit issues
 * - 1-minute polling is acceptable for most use cases
 * 
 * HTTP API Benefits:
 * - No WebSocket connection management complexity
 * - No React StrictMode double-mounting issues
 * - Easier to debug and maintain
 * - Predictable behavior
 * 
 * Rate Limit Mitigation:
 * - Server-side 10-minute cache
 * - Reduced polling interval (1 min vs 2 min)
 * - Backoff on 503 errors (2-5 minutes)
 * - Admin endpoint to clear backoff if needed
 * 
 * MQTT Note:
 * - Available but disabled by default (set useMQTT: true to enable)
 * - May cause connection loops in development mode
 * - Production environments may have better stability
 * 
 * Based on PSKReporter Developer Documentation:
 * https://pskreporter.info/pskdev.html
 */
import { useState, useEffect, useCallback, useRef } from 'react';

// Convert grid square to lat/lon
function gridToLatLon(grid) {
  if (!grid || grid.length < 4) return null;
  
  const g = grid.toUpperCase();
  const lon = (g.charCodeAt(0) - 65) * 20 - 180;
  const lat = (g.charCodeAt(1) - 65) * 10 - 90;
  const lonMin = parseInt(g[2]) * 2;
  const latMin = parseInt(g[3]) * 1;
  
  let finalLon = lon + lonMin + 1;
  let finalLat = lat + latMin + 0.5;
  
  if (grid.length >= 6) {
    const lonSec = (g.charCodeAt(4) - 65) * (2/24);
    const latSec = (g.charCodeAt(5) - 65) * (1/24);
    finalLon = lon + lonMin + lonSec + (1/24);
    finalLat = lat + latMin + latSec + (0.5/24);
  }
  
  return { lat: finalLat, lon: finalLon };
}

// Get band name from frequency in Hz
function getBandFromHz(freqHz) {
  const freqMHz = freqHz / 1000000;
  if (freqMHz >= 1.8 && freqMHz <= 2) return '160m';
  if (freqMHz >= 3.5 && freqMHz <= 4) return '80m';
  if (freqMHz >= 5.3 && freqMHz <= 5.4) return '60m';
  if (freqMHz >= 7 && freqMHz <= 7.3) return '40m';
  if (freqMHz >= 10.1 && freqMHz <= 10.15) return '30m';
  if (freqMHz >= 14 && freqMHz <= 14.35) return '20m';
  if (freqMHz >= 18.068 && freqMHz <= 18.168) return '17m';
  if (freqMHz >= 21 && freqMHz <= 21.45) return '15m';
  if (freqMHz >= 24.89 && freqMHz <= 24.99) return '12m';
  if (freqMHz >= 28 && freqMHz <= 29.7) return '10m';
  if (freqMHz >= 50 && freqMHz <= 54) return '6m';
  if (freqMHz >= 144 && freqMHz <= 148) return '2m';
  if (freqMHz >= 420 && freqMHz <= 450) return '70cm';
  return 'Unknown';
}

// HTTP poll interval (primary method - reliable and stable)
const HTTP_POLL_INTERVAL = 60000; // 1 minute (reduced from 2 for faster updates)
// MQTT is disabled by default (connection instability in React StrictMode)
// Can be enabled per-user basis if needed (experimental)
const ENABLE_MQTT = false;

export const usePSKReporter = (callsign, options = {}) => {
  const {
    minutes = 15,           // Time window to keep spots
    enabled = true,         // Enable/disable fetching
    maxSpots = 100,         // Max spots to keep
    useMQTT = ENABLE_MQTT   // Enable MQTT (true by default for real-time updates)
  } = options;

  const [txReports, setTxReports] = useState([]);
  const [rxReports, setRxReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [source, setSource] = useState(useMQTT ? 'connecting' : 'http');
  
  const clientRef = useRef(null);
  const txReportsRef = useRef([]);
  const rxReportsRef = useRef([]);
  const mountedRef = useRef(true);
  const httpIntervalRef = useRef(null);
  const mqttTimeoutRef = useRef(null);

  // Clean old spots (older than specified minutes)
  const cleanOldSpots = useCallback((spots, maxAgeMinutes) => {
    const cutoff = Date.now() - (maxAgeMinutes * 60 * 1000);
    return spots.filter(s => s.timestamp > cutoff).slice(0, maxSpots);
  }, [maxSpots]);

  // HTTP fetch (primary method)
  const fetchHTTP = useCallback(async (cs) => {
    if (!mountedRef.current || !cs) return;
    
    try {
      const res = await fetch(`/api/pskreporter/${encodeURIComponent(cs)}?minutes=${minutes}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const data = await res.json();
      if (!mountedRef.current) return;
      
      // Merge TX reports
      if (data.tx?.reports?.length) {
        txReportsRef.current = data.tx.reports.slice(0, maxSpots);
        setTxReports([...txReportsRef.current]);
      } else {
        txReportsRef.current = [];
        setTxReports([]);
      }
      
      // Merge RX reports
      if (data.rx?.reports?.length) {
        rxReportsRef.current = data.rx.reports.slice(0, maxSpots);
        setRxReports([...rxReportsRef.current]);
      } else {
        rxReportsRef.current = [];
        setRxReports([]);
      }
      
      setLastUpdate(new Date());
      setLoading(false);
      setError(null);
      setSource(useMQTT ? 'http+mqtt' : 'http');
      setConnected(true);
      
      console.log(`[PSKReporter HTTP] Loaded ${data.tx?.count || 0} TX, ${data.rx?.count || 0} RX for ${cs}`);
    } catch (err) {
      if (!mountedRef.current) return;
      console.error('[PSKReporter HTTP] Error:', err.message);
      setError('HTTP fetch failed');
      setLoading(false);
      setSource('error');
      setConnected(false);
    }
  }, [minutes, maxSpots, useMQTT]);

  // Process incoming MQTT message
  const processMessage = useCallback((topic, message) => {
    if (!mountedRef.current) return;
    
    try {
      const data = JSON.parse(message.toString());
      
      // PSKReporter MQTT message fields:
      // sc = sender call, rc = receiver call (NOT sa/ra which are ADIF country codes)
      // sl = sender locator, rl = receiver locator
      // f = frequency, md = mode, rp = report (SNR), t = timestamp, b = band
      const {
        sc: senderCallsign,
        sl: senderLocator,
        rc: receiverCallsign,
        rl: receiverLocator,
        f: frequency,
        md: mode,
        rp: snr,
        t: timestamp,
        b: band
      } = data;

      if (!senderCallsign || !receiverCallsign) return;

      const senderLoc = gridToLatLon(senderLocator);
      const receiverLoc = gridToLatLon(receiverLocator);
      const freq = parseInt(frequency) || 0;
      const now = Date.now();
      
      const report = {
        sender: senderCallsign,
        senderGrid: senderLocator,
        receiver: receiverCallsign,
        receiverGrid: receiverLocator,
        freq,
        freqMHz: freq ? (freq / 1000000).toFixed(3) : '?',
        band: band || getBandFromHz(freq),
        mode: mode || 'Unknown',
        snr: snr !== undefined ? parseInt(snr) : null,
        timestamp: timestamp ? timestamp * 1000 : now,
        age: 0,
        lat: null,
        lon: null
      };

      const upperCallsign = callsign?.toUpperCase();
      if (!upperCallsign) return;
      
      // If I'm the sender, this is a TX report (someone heard me)
      if (senderCallsign.toUpperCase() === upperCallsign) {
        report.lat = receiverLoc?.lat;
        report.lon = receiverLoc?.lon;
        
        // Add to front, dedupe by receiver+freq, limit size
        txReportsRef.current = [report, ...txReportsRef.current]
          .filter((r, i, arr) => 
            i === arr.findIndex(x => x.receiver === r.receiver && Math.abs(x.freq - r.freq) < 1000)
          )
          .slice(0, maxSpots);
        
        setTxReports(cleanOldSpots([...txReportsRef.current], minutes));
        setLastUpdate(new Date());
      }
      
      // If I'm the receiver, this is an RX report (I heard someone)
      if (receiverCallsign.toUpperCase() === upperCallsign) {
        report.lat = senderLoc?.lat;
        report.lon = senderLoc?.lon;
        
        rxReportsRef.current = [report, ...rxReportsRef.current]
          .filter((r, i, arr) => 
            i === arr.findIndex(x => x.sender === r.sender && Math.abs(x.freq - r.freq) < 1000)
          )
          .slice(0, maxSpots);
        
        setRxReports(cleanOldSpots([...rxReportsRef.current], minutes));
        setLastUpdate(new Date());
      }
      
    } catch (err) {
      // Silently ignore parse errors - malformed messages happen
    }
  }, [callsign, minutes, maxSpots, cleanOldSpots]);

  // Connect with HTTP polling (stable, reliable)
  useEffect(() => {
    mountedRef.current = true;
    
    if (!callsign || callsign === 'N0CALL' || !enabled) {
      setTxReports([]);
      setRxReports([]);
      setLoading(false);
      setSource('disabled');
      setConnected(false);
      return;
    }

    const upperCallsign = callsign.toUpperCase();
    
    // Clear old data
    txReportsRef.current = [];
    rxReportsRef.current = [];
    setTxReports([]);
    setRxReports([]);
    setLoading(true);
    setError(null);
    setSource('http');

    console.log(`[PSKReporter] Starting HTTP${useMQTT ? ' + MQTT (experimental)' : '-only'} mode for ${upperCallsign}`);

    // PRIMARY: HTTP polling (stable and reliable)
    fetchHTTP(upperCallsign);
    httpIntervalRef.current = setInterval(() => {
      if (mountedRef.current) fetchHTTP(upperCallsign);
    }, HTTP_POLL_INTERVAL);

    // OPTIONAL: MQTT enhancement (disabled by default, experimental)
    if (useMQTT) {
      console.warn('[PSKReporter] MQTT enabled (experimental) - may cause connection loops');
      
      mqttTimeoutRef.current = setTimeout(() => {
        if (!mountedRef.current || connected) return;
        console.log('[PSKReporter] MQTT timeout, continuing with HTTP-only...');
      }, 8000);

      import('mqtt').then(({ default: mqtt }) => {
        if (!mountedRef.current) return;
        
        const client = mqtt.connect('wss://mqtt.pskreporter.info:1886/mqtt', {
          clientId: `ohc_${upperCallsign}_${Math.random().toString(16).substr(2, 6)}`,
          clean: true,
          connectTimeout: 15000,
          reconnectPeriod: 0, // Disable auto-reconnect to prevent loops
          keepalive: 60
        });

        clientRef.current = client;

        client.on('connect', () => {
          if (!mountedRef.current) return;
          
          if (mqttTimeoutRef.current) {
            clearTimeout(mqttTimeoutRef.current);
            mqttTimeoutRef.current = null;
          }
          
          console.log('[PSKReporter MQTT] Connected (experimental)');
          setConnected(true);
          setSource('http+mqtt');

          const txTopic = `pskr/filter/v2/+/+/${upperCallsign}/#`;
          const rxTopic = `pskr/filter/v2/+/+/+/${upperCallsign}/#`;
          
          client.subscribe([txTopic, rxTopic], { qos: 0 }, (err) => {
            if (err) {
              console.error('[PSKReporter MQTT] Subscribe error:', err.message);
            } else {
              console.log('[PSKReporter MQTT] Subscribed to TX and RX');
            }
          });
        });

        client.on('message', processMessage);

        client.on('error', (err) => {
          if (!mountedRef.current) return;
          console.warn('[PSKReporter MQTT] Error (HTTP continues):', err.message);
        });

        client.on('close', () => {
          if (!mountedRef.current) return;
          console.log('[PSKReporter MQTT] Disconnected (HTTP continues)');
          setConnected(false);
          setSource('http');
        });
      }).catch((err) => {
        console.log('[PSKReporter MQTT] Not available:', err.message);
      });
    }

    // Cleanup
    return () => {
      mountedRef.current = false;
      if (mqttTimeoutRef.current) {
        clearTimeout(mqttTimeoutRef.current);
        mqttTimeoutRef.current = null;
      }
      if (httpIntervalRef.current) {
        clearInterval(httpIntervalRef.current);
        httpIntervalRef.current = null;
      }
      if (clientRef.current) {
        console.log('[PSKReporter MQTT] Cleaning up...');
        clientRef.current.end(true);
        clientRef.current = null;
      }
    };
  }, [callsign, enabled, useMQTT, fetchHTTP, processMessage, connected]);

  // Periodically clean old spots and update ages
  useEffect(() => {
    if (!enabled) return;
    
    const interval = setInterval(() => {
      // Update ages and clean old spots
      const now = Date.now();
      
      setTxReports(prev => prev.map(r => ({
        ...r,
        age: Math.floor((now - r.timestamp) / 60000)
      })).filter(r => r.age <= minutes));
      
      setRxReports(prev => prev.map(r => ({
        ...r,
        age: Math.floor((now - r.timestamp) / 60000)
      })).filter(r => r.age <= minutes));
      
    }, 30000); // Every 30 seconds
    
    return () => clearInterval(interval);
  }, [enabled, minutes]);

  // Manual refresh - force immediate fetch
  const refresh = useCallback(() => {
    if (callsign && callsign !== 'N0CALL') {
      console.log('[PSKReporter] Manual refresh triggered');
      fetchHTTP(callsign.toUpperCase());
    }
  }, [callsign, fetchHTTP]);

  return {
    txReports,
    txCount: txReports.length,
    rxReports,
    rxCount: rxReports.length,
    loading,
    error,
    connected,
    source,
    lastUpdate,
    refresh
  };
};

export default usePSKReporter;

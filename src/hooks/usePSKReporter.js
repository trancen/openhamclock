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

// MQTT is enabled by default - proper real-time subscription (no polling!)
const ENABLE_MQTT = true;
// MQTT connection timeout - fall back to HTTP if MQTT doesn't connect
const MQTT_TIMEOUT_MS = 10000; // 10 seconds
// HTTP poll interval (fallback only, not used when MQTT is connected)
const HTTP_POLL_INTERVAL = 120000; // 2 minutes

export const usePSKReporter = (callsign, options = {}) => {
  const {
    minutes = 15,           // Time window to keep spots
    enabled = true,         // Enable/disable fetching
    maxSpots = 100,         // Max spots to keep
    useMQTT = ENABLE_MQTT,  // Enable MQTT (true by default for real-time updates)
    mode = null             // Filter by mode (e.g., 'WSPR', 'FT8', 'FT4') - null = all modes
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
  const isConnectingRef = useRef(false); // Prevent duplicate connections

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
        md: messageMode,
        rp: snr,
        t: timestamp,
        b: band
      } = data;

      if (!senderCallsign || !receiverCallsign) return;
      
      // Filter by mode if specified (e.g., 'WSPR' only)
      if (mode && messageMode && messageMode.toUpperCase() !== mode.toUpperCase()) {
        return; // Skip spots that don't match the requested mode
      }

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
        mode: messageMode || 'Unknown',
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
  }, [callsign, minutes, maxSpots, cleanOldSpots, mode]);

  // Connect with MQTT-first (real-time subscription) with HTTP fallback
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

    // Prevent duplicate connections (React StrictMode protection)
    if (isConnectingRef.current) {
      console.log('[PSKReporter] Connection already in progress, skipping...');
      return;
    }
    
    // If a connection exists, reuse it instead of creating a new one
    if (clientRef.current && clientRef.current.connected) {
      console.log('[PSKReporter MQTT] Reusing existing connection for', upperCallsign);
      setConnected(true);
      setSource('mqtt');
      setLoading(false);
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
    setSource(useMQTT ? 'connecting' : 'http');

    console.log(`[PSKReporter] Starting ${useMQTT ? 'MQTT (real-time subscription)' : 'HTTP-only'} mode for ${upperCallsign}`);

    // MQTT: Real-time subscription (no polling!)
    if (useMQTT) {
      isConnectingRef.current = true;
      
      // Load historical data via HTTP FIRST, then switch to MQTT for real-time updates
      console.log('[PSKReporter] Loading historical data via HTTP...');
      fetchHTTP(upperCallsign).then(() => {
        if (!mountedRef.current) return;
        console.log('[PSKReporter] Historical data loaded, now connecting to MQTT for real-time updates...');
      });
      
      // Timeout: Fall back to HTTP if MQTT doesn't connect
      mqttTimeoutRef.current = setTimeout(() => {
        if (!mountedRef.current || connected) return;
        
        console.log('[PSKReporter] MQTT timeout, falling back to HTTP polling...');
        setSource('http-fallback');
        isConnectingRef.current = false;
        
        // Start HTTP fallback
        fetchHTTP(upperCallsign);
        httpIntervalRef.current = setInterval(() => {
          if (mountedRef.current) fetchHTTP(upperCallsign);
        }, HTTP_POLL_INTERVAL);
      }, MQTT_TIMEOUT_MS);

      import('mqtt').then(({ default: mqtt }) => {
        if (!mountedRef.current) {
          isConnectingRef.current = false;
          return;
        }
        
        // Double-check no connection exists
        if (clientRef.current) {
          console.log('[PSKReporter MQTT] Connection already exists, aborting duplicate');
          isConnectingRef.current = false;
          return;
        }
        
        console.log('[PSKReporter MQTT] Connecting for', upperCallsign);
        
        const client = mqtt.connect('wss://mqtt.pskreporter.info:1886/mqtt', {
          clientId: `ohc_${upperCallsign}_${Math.random().toString(16).substr(2, 8)}`,
          clean: true,
          connectTimeout: 15000,
          reconnectPeriod: 0, // Disable auto-reconnect (we handle it manually)
          keepalive: 60,
          will: {
            topic: 'disconnect',
            payload: upperCallsign,
            qos: 0,
            retain: false
          }
        });

        clientRef.current = client;

        client.on('connect', () => {
          if (!mountedRef.current) return;
          
          // Cancel HTTP fallback
          if (mqttTimeoutRef.current) {
            clearTimeout(mqttTimeoutRef.current);
            mqttTimeoutRef.current = null;
          }
          if (httpIntervalRef.current) {
            clearInterval(httpIntervalRef.current);
            httpIntervalRef.current = null;
          }
          
          isConnectingRef.current = false;
          console.log('[PSKReporter MQTT] Connected! Real-time subscription active.');
          setConnected(true);
          setLoading(false);
          setSource('mqtt');
          setError(null);

          // Subscribe to TX and RX topics (real-time push, no polling!)
          const txTopic = `pskr/filter/v2/+/+/${upperCallsign}/#`;
          const rxTopic = `pskr/filter/v2/+/+/+/${upperCallsign}/#`;
          
          // Ensure client is still connected before subscribing
          if (!client.connected) {
            console.warn('[PSKReporter MQTT] Client disconnected before subscribe, waiting...');
            return;
          }
          
          client.subscribe([txTopic, rxTopic], { qos: 0 }, (err) => {
            if (err) {
              console.error('[PSKReporter MQTT] Subscribe error:', err.message || err);
              // Don't treat subscribe errors as fatal - connection may still work
            } else {
              console.log('[PSKReporter MQTT] Subscribed - awaiting real-time messages');
            }
          });
        });

        client.on('message', (topic, message) => {
          // Real-time message received!
          console.log('[PSKReporter MQTT] Real-time spot received:', topic);
          processMessage(topic, message);
        });

        client.on('error', (err) => {
          if (!mountedRef.current) return;
          console.error('[PSKReporter MQTT] Error:', err.message);
          setError('MQTT error');
          isConnectingRef.current = false;
        });

        client.on('close', () => {
          if (!mountedRef.current) return;
          console.log('[PSKReporter MQTT] Disconnected');
          setConnected(false);
          isConnectingRef.current = false;
        });
      }).catch((err) => {
        console.error('[PSKReporter MQTT] Failed to load:', err.message);
        isConnectingRef.current = false;
        
        // HTTP fallback
        fetchHTTP(upperCallsign);
        httpIntervalRef.current = setInterval(() => {
          if (mountedRef.current) fetchHTTP(upperCallsign);
        }, HTTP_POLL_INTERVAL);
      });
    } else {
      // HTTP-only polling mode
      fetchHTTP(upperCallsign);
      httpIntervalRef.current = setInterval(() => {
        if (mountedRef.current) fetchHTTP(upperCallsign);
      }, HTTP_POLL_INTERVAL);
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
        console.log('[PSKReporter MQTT] Cleaning up connection...');
        clientRef.current.end(true);
        clientRef.current = null;
      }
      isConnectingRef.current = false;
    };
  }, [callsign, enabled, useMQTT, fetchHTTP, processMessage]);

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

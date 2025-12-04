const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mqtt = require('mqtt'); // Додано MQTT
const os = require('os');

const app = express();
const PORT = process.env.PORT || 80;

// Increase limit if payloads may be large
app.use(bodyParser.json({ limit: '256kb' }));

// Views and static assets (for frontend rendering)
const hbs = require('hbs');
hbs.registerPartials(path.join(__dirname, 'views'));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');
app.use(express.static(path.join(__dirname, 'public')));
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));

// Register a simple helper to pretty-print JSON in templates
hbs.registerHelper('json', function(context) {
  try {
    return new hbs.handlebars.SafeString('<pre>' + JSON.stringify(context, null, 2) + '</pre>');
  } catch (e) {
    return '';
  }
});

// Register a helper to format numbers to a fixed number of decimal places
hbs.registerHelper('toFixed', function(number, digits) {
  if (typeof number === 'number') {
    return number.toFixed(digits);
  }
  return number;
});

// Ensure upload directory exists
const UPLOAD_DIR = path.join(__dirname, 'upload');
try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (e) {
  console.error('Failed to ensure upload directory exists:', e);
}

// Simple request logger middleware
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] --> ${req.method} ${req.originalUrl} from ${req.ip}`);
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] <-- ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// --- CONFIGURATION ---
const CONFIG_FILE = path.join(__dirname, 'config.json');
let config = {
  enableAutoLight: false,
  enableLightThreshold: false,
  lightThreshold: 40,
  uploadIntervalSeconds: 30,
  autoLightStartTime: "07:00",
  autoLightEndTime: "22:00",
  lastSavedLocalTime: null,
  wifi: [],
  sendAddresses: [],
  deviceName: "",
  // Нові налаштування для MQTT
  mqtt: {
    enabled: false,
    brokerUrl: "mqtts://mqtt-dashboard.com:8883",
    username: "",
    password: "",
    baseTopic: "esp_device"
  }
};

// Завантажуємо конфігурацію при старті
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const rawConfig = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(rawConfig);
    // Merge recursively to ensure new sub-objects like 'mqtt' are added
    config = Object.assign(config, parsed);
    if (parsed.mqtt) {
        config.mqtt = Object.assign(config.mqtt, parsed.mqtt);
    }
    // backward compatibility for wifi
    if (Array.isArray(parsed.wifi)) {
      config.wifi = parsed.wifi.map(w => ({ ssid: w.ssid || '', password: w.password || '', enabled: !!w.enabled }));
    } else if (parsed.wifi && typeof parsed.wifi === 'object') {
      config.wifi = [{ ssid: parsed.wifi.ssid || '', password: parsed.wifi.password || '', enabled: true }];
    }
    console.log('Configuration loaded:', config);
  } else {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    console.log('Default configuration created.');
  }
} catch (e) {
  console.error('Failed to load or create config file:', e);
}


// --- MQTT SETUP ---
let mqttClient = null;

function connectMqtt() {
  if (!config.mqtt.enabled) {
    console.log('[MQTT] MQTT is disabled in config.');
    return;
  }
  if (mqttClient && (mqttClient.connected || mqttClient.connecting)) {
      console.log('[MQTT] Client is already connected or connecting.');
      return; 
  }

  const options = {
    username: config.mqtt.username,
    password: config.mqtt.password,
    clientId: "clientId-2b84Npwmru"
  };

  console.log(`[MQTT] Connecting to ${config.mqtt.brokerUrl}`);
  mqttClient = mqtt.connect(config.mqtt.brokerUrl, options);

  mqttClient.on('connect', () => {
    console.log('[MQTT] Connected to broker.');
    const telemetryTopic = `${config.mqtt.baseTopic}/telemetry`;
    mqttClient.subscribe(telemetryTopic, (err) => {
      if (!err) {
        console.log(`[MQTT] Subscribed to telemetry topic: ${telemetryTopic}`);
      } else {
        console.error(`[MQTT] Failed to subscribe to ${telemetryTopic}:`, err);
      }
    });
  });

  mqttClient.on('error', (err) => {
    console.error('[MQTT] Connection error:', err);
  });

  mqttClient.on('reconnect', () => {
    console.log('[MQTT] Reconnecting...');
  });

  mqttClient.on('close', () => {
    console.log('[MQTT] Connection closed.');
  });

  mqttClient.on('message', (topic, message) => {
    console.log(`[MQTT] Received message on topic ${topic}`);
    if (topic === `${config.mqtt.baseTopic}/telemetry`) {
      try {
        const data = JSON.parse(message.toString());
        processUploadedData(data, 'MQTT');
      } catch (e) {
        console.error('[MQTT] Failed to parse telemetry message:', e);
      }
    }
  });
}

function publishMqtt(topic, message, options) {
    if (mqttClient && mqttClient.connected) {
        mqttClient.publish(topic, message, options, (err) => {
            if (err) {
                console.error(`[MQTT] Failed to publish to ${topic}:`, err);
            } else {
                console.log(`[MQTT] Published to ${topic}: ${message}`);
            }
        });
    } else {
        console.warn(`[MQTT] Cannot publish. Client not connected.`);
    }
}

// --- END MQTT SETUP ---


// Endpoint to get the current config
app.get('/api/config', (req, res) => {
  res.json(config);
});

// Endpoint to update the config
app.post('/api/config', (req, res) => {
  try {
    const newConfig = req.body;
    const oldMqttConfig = JSON.stringify(config.mqtt);

    // Оновлюємо конфігурацію
    Object.keys(newConfig).forEach(key => {
        if (key === 'mqtt' && typeof newConfig.mqtt === 'object') {
            config.mqtt = Object.assign(config.mqtt, newConfig.mqtt);
        } else if (config.hasOwnProperty(key)) {
            config[key] = newConfig[key];
        }
    });
    
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    console.log('Configuration persisted to file.');

    // Handle MQTT connection changes and publish config to device
    if (config.mqtt.enabled) {
        const newMqttConfig = JSON.stringify(config.mqtt);
        if (newMqttConfig !== oldMqttConfig) {
            console.log('[MQTT] MQTT config changed, reconnecting...');
            if (mqttClient) {
                mqttClient.end(true, () => connectMqtt());
            } else {
                connectMqtt();
            }
        }
        
        const configTopic = `${config.mqtt.baseTopic}/control/config`;
        const { mqtt, ...espConfig } = config;
        publishMqtt(configTopic, JSON.stringify(espConfig), { retain: true });
    }

    res.json({ status: 'ok', config });
  } catch (e) {
    console.error('Failed to write config:', e);
    res.status(500).json({ error: 'failed to write config' });
  }
});

/**
 * Unified function to process data from ESP (via HTTP or MQTT)
 * @param {object} data - Data from ESP.
 * @param {string} source - 'HTTP' or 'MQTT'.
 */
async function processUploadedData(data, source = 'HTTP') {
  console.log(`Processing data from ${source}:`, data);

  const outPath = path.join(__dirname, 'received.json');
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');

  const id = Date.now().toString() + '-' + crypto.randomBytes(4).toString('hex');
  const filename = `${id}.json`;
  const filePath = path.join(UPLOAD_DIR, filename);
  const record = {
    meta: { id, time: new Date().toISOString(), source },
    data
  };
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
  console.log(`Saved upload record to ${filePath}`);

  sendSseEvent('new', record.data);

  // --- Server-side Auto-light Logic ---
  const autoModeActive = config.enableAutoLight || config.enableLightThreshold;
  if (autoModeActive && data.lux !== undefined) {
      const isWithinSchedule = (start, end) => {
          if (!start || !end || !/^\\d{2}:\\d{2}$/.test(start) || !/^\\d{2}:\\d{2}$/.test(end)) return true;
          const now = new Date();
          const offsetHours = 2; // UTC+2
          const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
          const tzDate = new Date(utcMs + (offsetHours * 3600000));
          const nowMinutes = tzDate.getHours() * 60 + tzDate.getMinutes();
          const [startH, startM] = start.split(':').map(Number);
          const startMinutes = startH * 60 + startM;
          const [endH, endM] = end.split(':').map(Number);
          const endMinutes = endH * 60 + endM;
          if (startMinutes <= endMinutes) return nowMinutes >= startMinutes && nowMinutes < endMinutes;
          return nowMinutes >= startMinutes || nowMinutes < endMinutes;
      };

      const withinSchedule = isWithinSchedule(config.autoLightStartTime, config.autoLightEndTime);
      const isDark = data.lux < config.lightThreshold;
      
      let shouldTurnOn = false;
      if (config.enableAutoLight && !config.enableLightThreshold) shouldTurnOn = withinSchedule;
      else if (!config.enableAutoLight && config.enableLightThreshold) shouldTurnOn = isDark;
      else if (config.enableAutoLight && config.enableLightThreshold) shouldTurnOn = withinSchedule && isDark;
      
      let currentPinStates = {};
      if (fs.existsSync(PINS_STATE_FILE)) {
          try {
              currentPinStates = JSON.parse(fs.readFileSync(PINS_STATE_FILE, 'utf8'));
          } catch (e) { console.error('[Auto-Light] Failed to parse pins.json:', e); }
      }

      const desiredState = shouldTurnOn ? 1 : 0;
      if (currentPinStates.pin12 !== desiredState) {
          console.log(`[Auto-Light] Server logic changing pin12 to ${desiredState}.`);
          await updatePinState('pin12', desiredState);
      }
  } else if (!autoModeActive) {
      // Turn light off if automation is disabled
  }
}

// Legacy endpoint for backward compatibility
app.post('/upload', async (req, res) => {
  try {
    console.log('Received legacy HTTP upload from ESP.');
    await processUploadedData(req.body, 'HTTP');
    return res.status(200).json( {
      status: 'ok',
      uploadIntervalSeconds: config.uploadIntervalSeconds
    });
  } catch (err) {
    console.error('Error handling /upload:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// --- PIN CONTROL LOGIC ---
const PINS_STATE_FILE = path.join(__dirname, 'pins.json');
const pinMapping = { '12': 12, '13': 13, '14': 14 };

/**
 * Updates the state of a specific pin, saves it, and sends the command via MQTT.
 * @param {string} pinName - The name of the pin (e.g., 'pin12').
 * @param {0 | 1} state - The new state (0 for OFF, 1 for ON).
 */
async function updatePinState(pinName, state) {
  const logicalPinNumber = pinName.replace('pin', '');
  const gpioPinNumber = pinMapping[logicalPinNumber] || logicalPinNumber;

  if (state !== 0 && state !== 1) {
    throw new Error('Invalid state. Must be 0 or 1.');
  }

  let pins = {};
  if (fs.existsSync(PINS_STATE_FILE)) {
    try {
        pins = JSON.parse(fs.readFileSync(PINS_STATE_FILE, 'utf8'));
    } catch(e) { console.error("Failed to parse pins.json", e); }
  }

  pins[pinName] = state;
  fs.writeFileSync(PINS_STATE_FILE, JSON.stringify(pins, null, 2), 'utf8');
  console.log(`[Pin Control] Set pin ${pinName} state to ${state} in pins.json`);

  if (config.mqtt.enabled) {
    const topic = `${config.mqtt.baseTopic}/control/pins`;
    const message = JSON.stringify({ pin: gpioPinNumber, state: state });
    publishMqtt(topic, message);
  } else {
    console.warn('[Pin Control] Cannot send command to ESP: MQTT is disabled.');
  }

  return { status: 'ok', state, sentToEsp: config.mqtt.enabled };
}

// Endpoint to update a specific pin
app.post('/api/pins/:pin', async (req, res) => {
  try {
    const pinName = req.params.pin;
    const { state } = req.body;
    const result = await updatePinState(pinName, state);

    if (pinName === 'pin12' && (config.enableAutoLight || config.enableLightThreshold)) {
      console.log('[Auto-Light] Manual override on pin12 detected. Disabling automation.');
      config.enableAutoLight = false;
      config.enableLightThreshold = false;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
      
      if (config.mqtt.enabled) {
          const configTopic = `${config.mqtt.baseTopic}/control/config`;
          publishMqtt(configTopic, JSON.stringify({ enableAutoLight: false, enableLightThreshold: false }), { retain: true });
      }
    }
    res.json(result);
  } catch (e) {
    console.error(`[Pin Control] Failed to write pin ${req.params.pin} state:`, e);
    res.status(500).json({ error: `failed to write pin ${req.params.pin} state` });
  }
});

// --- UI AND API ENDPOINTS (MOSTLY UNCHANGED) ---

app.get('/', (req, res) => {
  res.send(`ESP receiver is running. Use /control, /view, /settings.<br/>`);
});

app.get('/view', (req, res) => {
  // This endpoint remains the same, reading from the upload directory
  res.render('dashboard');
});

app.get('/control', (req, res) => {
  res.render('controll');
});

app.get('/chart', (req, res) => {
    return res.render('chart');
});

app.get('/settings', (req, res) => {
    return res.render('settings');
});

app.get('/pins.json', (req, res) => {
  try {
    if (fs.existsSync(PINS_STATE_FILE)) {
      const state = fs.readFileSync(PINS_STATE_FILE, 'utf8');
      res.json(JSON.parse(state));
    } else {
      res.json({});
    }
  } catch (e) {
    console.error('Failed to read pins state from /pins.json:', e);
    res.status(500).json({ error: 'failed to read pins state' });
  }
});

// Other API endpoints for fetching data also remain unchanged as they read from the filesystem
app.get('/api/latest-data', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.endsWith('.json')).sort().reverse();
    if (files.length > 0) {
      const raw = fs.readFileSync(path.join(UPLOAD_DIR, files[0]), 'utf8');
      return res.json(JSON.parse(raw).data || {});
    }
    return res.status(404).json({ error: 'No data available' });
  } catch (e) {
    console.error('Failed to get latest data for API:', e);
    return res.status(500).json({ error: 'Failed to read latest data' });
  }
});

app.get('/api/history', (req, res) => {
    try {
        const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.endsWith('.json'));
        const history = files.map(f => {
            try {
                const raw = fs.readFileSync(path.join(UPLOAD_DIR, f), 'utf8');
                const parsed = JSON.parse(raw);
                return { timestamp: parsed?.meta?.time || null, ...parsed.data };
            } catch (e) { return null; }
        }).filter(Boolean).sort((a,b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
        res.json(history);
    } catch (e) {
        console.error('Failed to get history data for API:', e);
        res.status(500).json({ error: 'Failed to read history data' });
    }
});

// Server-Sent Events
const sseClients = new Set();
function sendSseEvent(event, payload) {
  const msg = `event: ${event}\n` + `data: ${JSON.stringify(payload)}

`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (e) { console.error('SSE write error:', e); }
  }
}

app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders && res.flushHeaders();
  res.write(': connected\n\n');
  sseClients.add(res);
  req.on('close', () => { sseClients.delete(res); });
});


// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Print startup URLs
function getLocalNetworkAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

// Bind to 0.0.0.0 to accept connections from the LAN
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
  getLocalNetworkAddresses().forEach(addr => {
    console.log(`On your network: http://${addr}:${PORT}`);
  });

  // Ініціалізуємо MQTT з'єднання після старту сервера
  connectMqtt();
});
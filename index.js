const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');

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
  // Return the original value if it's not a number (e.g., null or undefined)
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

  // capture finish to log response status and duration
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] <-- ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });

  next();
});

// Зберігаємо останню відому IP-адресу пристрою
let lastKnownIp = null;

const CONFIG_FILE = path.join(__dirname, 'config.json');
let config = {
  enableAutoLight: false,
  lightThreshold: 40,
  uploadIntervalSeconds: 30,
  // Auto-light schedule
  autoLightStartTime: "07:00",
  autoLightEndTime: "22:00",
  // Last time settings were saved in UTC+2 (string)
  lastSavedLocalTime: null,
  // New fields
  // wifi is an ordered array of networks { ssid, password, enabled }
  wifi: [],
  sendAddresses: [],
  deviceName: ""
};

// Завантажуємо конфігурацію при старті
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const rawConfig = fs.readFileSync(CONFIG_FILE, 'utf8');
    try {
      const parsed = JSON.parse(rawConfig);
      // Ensure new fields exist when loading older configs
      config = Object.assign({}, config, parsed);
      // wifi backward compatibility: accept object or array
      if (Array.isArray(parsed.wifi)) {
        config.wifi = parsed.wifi.map(w => ({ ssid: w.ssid || '', password: w.password || '', enabled: !!w.enabled }));
      } else if (parsed.wifi && typeof parsed.wifi === 'object') {
        // single network stored as object in older configs
        config.wifi = [{ ssid: parsed.wifi.ssid || '', password: parsed.wifi.password || '', enabled: true }];
      } else {
        config.wifi = config.wifi || [];
      }
      config.sendAddresses = Array.isArray(parsed.sendAddresses) ? parsed.sendAddresses : (config.sendAddresses || []);
      config.deviceName = typeof parsed.deviceName === 'string' ? parsed.deviceName : (config.deviceName || '');
      console.log('Configuration loaded:', config);
    } catch (e) {
      console.error('Failed to parse config, using defaults:', e);
    }
  } else {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    console.log('Default configuration created.');
  }
} catch (e) {
  console.error('Failed to load or create config file:', e);
}

// Endpoint to get the current config
app.get('/api/config', (req, res) => {
  res.json(config);
});

// Endpoint to update the config
app.post('/api/config', (req, res) => {
  try {
    // Валідація та оновлення
    const newConfig = req.body;
    // Only update enableAutoLight when explicitly provided to avoid other form posts
    if (typeof newConfig.enableAutoLight !== 'undefined') {
      const prev = config.enableAutoLight;
      config.enableAutoLight = !!newConfig.enableAutoLight;
      if (prev !== config.enableAutoLight) console.log(`[Config] enableAutoLight changed: ${prev} -> ${config.enableAutoLight}`);
    }
    if (typeof newConfig.lightThreshold === 'number') {
      config.lightThreshold = newConfig.lightThreshold;
    }
    if (typeof newConfig.uploadIntervalSeconds === 'number') {
      config.uploadIntervalSeconds = newConfig.uploadIntervalSeconds;
    }
    // Auto-light schedule times (HH:MM strings)
    if (typeof newConfig.autoLightStartTime === 'string') {
      config.autoLightStartTime = newConfig.autoLightStartTime;
    }
    if (typeof newConfig.autoLightEndTime === 'string') {
      config.autoLightEndTime = newConfig.autoLightEndTime;
    }
    // Wifi list (array of { ssid, password, enabled })
    if (Array.isArray(newConfig.wifi)) {
      config.wifi = newConfig.wifi.map(w => ({
        ssid: typeof w.ssid === 'string' ? w.ssid : '',
        password: typeof w.password === 'string' ? w.password : '',
        enabled: !!w.enabled
      }));
    } else if (newConfig.wifi && typeof newConfig.wifi === 'object') {
      // accept single object for backward compatibility
      config.wifi = [{
        ssid: typeof newConfig.wifi.ssid === 'string' ? newConfig.wifi.ssid : '',
        password: typeof newConfig.wifi.password === 'string' ? newConfig.wifi.password : '',
        enabled: true
      }];
    }
    // Addresses to send data to (array of strings)
    if (Array.isArray(newConfig.sendAddresses)) {
      // sanitize: keep only strings
      config.sendAddresses = newConfig.sendAddresses.filter(a => typeof a === 'string');
    }
    // Device name used by ESP as Device Information Name
    if (typeof newConfig.deviceName === 'string') {
      config.deviceName = newConfig.deviceName;
    }
    // currentTime updates (from UI) - expected ISO string in UTC+2
    if (typeof newConfig.currentTime === 'string') {
      config.currentTime = newConfig.currentTime;
      // also mirror into lastSavedLocalTime for backward compatibility / ESP base time
      config.lastSavedLocalTime = newConfig.currentTime;
      console.log(`[Time Update] currentTime received from UI: ${config.currentTime}`);
    }
    
    // Save server-side timestamp in UTC+2 to help devices/local display
    try {
      const now = new Date();
      const offsetHours = 2; // UTC+2 requested
      const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
      const tzDate = new Date(utcMs + offsetHours * 3600000);
      const pad = (n) => String(n).padStart(2, '0');
      const formatted = `${tzDate.getFullYear()}-${pad(tzDate.getMonth()+1)}-${pad(tzDate.getDate())}T${pad(tzDate.getHours())}:${pad(tzDate.getMinutes())}:${pad(tzDate.getSeconds())}+02:00`;
      config.lastSavedLocalTime = formatted;
      // keep a separate currentTime field if not present
      if (!config.currentTime) config.currentTime = formatted;
    } catch (e) {
      console.warn('Failed to compute local save time:', e);
      config.lastSavedLocalTime = new Date().toISOString();
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    console.log('Configuration updated:', config);
    res.json({ status: 'ok', config });
  } catch (e) {
    console.error('Failed to write config:', e);
    res.status(500).json({ error: 'failed to write config' });
  }
});


app.post('/upload', async (req, res) => {
  try {
    const data = req.body;
    console.log('Received upload from ESP at', new Date().toISOString());

    if (data.ip) {
        lastKnownIp = data.ip;
        console.log(`[IP Update] Last known ESP IP updated to: ${lastKnownIp}`);
    }

    const outPath = path.join(__dirname, 'received.json');
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Saved received payload to ${outPath}`);

    const id = Date.now().toString() + '-' + crypto.randomBytes(4).toString('hex');
    const filename = `${id}.json`;
    const filePath = path.join(UPLOAD_DIR, filename);
    const record = {
      meta: { id, time: new Date().toISOString(), ip: req.ip, method: req.method, url: req.originalUrl },
      data
    };
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
    console.log(`Saved upload record to ${filePath}`);

    sendSseEvent('new', record.data);

    // --- Auto-light Logic ---
    if (config.enableAutoLight && data.lux !== undefined) {
      const desiredState = data.lux < config.lightThreshold ? 1 : 0;
      
      let currentPinStates = {};
      if (fs.existsSync(PINS_STATE_FILE)) {
        currentPinStates = JSON.parse(fs.readFileSync(PINS_STATE_FILE, 'utf8'));
      }
      
      if (currentPinStates.pin12 !== desiredState) {
        console.log(`[Auto-Light] Lux is ${data.lux}, threshold is ${config.lightThreshold}. Changing pin12 to ${desiredState}`);
        await updatePinState('pin12', desiredState);
      }
    }
    // --- End Auto-light Logic ---

    return res.status(200).json({ 
      status: 'ok', 
      uploadFile: filename,
      uploadIntervalSeconds: config.uploadIntervalSeconds 
    });

  } catch (err) {
    console.error('Error handling /upload:', err);
    // Avoid crashing on file write errors, etc.
    if (!res.headersSent) {
      res.status(500).json({ status: 'error', message: err.message });
    }
  }
});

// Provide a lightweight readiness check on the same path so ESP can poll
app.get('/upload', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/', (req, res) => {
  res.send(`ESP receiver - POST JSON to /upload<br/><a href="/view">View received data</a>`);
});

// Render received.json on a simple frontend using Handlebars
app.get('/view', (req, res) => {
  // Build list of uploads for the left sidebar
  let list = [];
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.endsWith('.json'));
    list = files.map(f => {
      try {
        const raw = fs.readFileSync(path.join(UPLOAD_DIR, f), 'utf8');
        const parsed = JSON.parse(raw);
        return {
          id: f,
          time: parsed?.meta?.time || null,
          summary: (parsed?.data?.device ? `${parsed.data.device.name || ''} ${parsed.data.device.chipModel || ''}`.trim() : (parsed?.data?.message || '')),
          device: parsed?.data?.device || {},
          network: parsed?.data?.network || {}
        };
      } catch (e) {
        return { id: f, time: null, summary: '' };
      }
    }).sort((a,b) => (b.time || '').localeCompare(a.time || ''));
  } catch (e) {
    console.error('Failed to build uploads list for /view:', e);
  }

  return res.render('dashboard', { exists: true, list });
});

// Render a dedicated mobile-first control page
app.get('/control', (req, res) => {
  let latestData = null;
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.endsWith('.json'));
    if (files.length > 0) {
      // Сортуємо файли за назвою (яка містить timestamp), щоб знайти останній
      files.sort().reverse();
      const latestFile = files[0];
      const raw = fs.readFileSync(path.join(UPLOAD_DIR, latestFile), 'utf8');
      const parsed = JSON.parse(raw);
      // Передаємо тільки дані з датчиків
      latestData = parsed.data; 
    }
  } catch (e) {
    console.error('Failed to get latest data for /control page:', e);
  }
  // Передаємо дані в шаблон
  return res.render('controll', { latestData });
});

// API: Get latest sensor data for real-time updates
app.get('/api/latest-data', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.endsWith('.json'));
    if (files.length > 0) {
      files.sort().reverse();
      const latestFile = files[0];
      const raw = fs.readFileSync(path.join(UPLOAD_DIR, latestFile), 'utf8');
      const parsed = JSON.parse(raw);
      // Return just the sensor data object
      return res.json(parsed.data || {});
    } else {
      // If no data is available, return an empty object or an error
      return res.status(404).json({ error: 'No data available' });
    }
  } catch (e) {
    console.error('Failed to get latest data for API:', e);
    return res.status(500).json({ error: 'Failed to read latest data' });
  }
});

// API: list uploads with pagination
app.get('/api/uploads', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const start = (page - 1) * limit;

    const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.endsWith('.json'));
    const list = files.map(f => {
      try {
        const raw = fs.readFileSync(path.join(UPLOAD_DIR, f), 'utf8');
        const parsed = JSON.parse(raw);
        // Read the full data object for device and network info
        // Перетворюємо дані в потрібний формат
        const deviceInfo = {
          name: parsed?.data?.deviceName || parsed?.data?.device || 'Unknown Device',
          chipModel: parsed?.data?.chipModel || 'ESP',
          cpuFreqMHz: parsed?.data?.cpuFreqMHz || null,
          flashSizeMB: parsed?.data?.flashSizeMB || null,
          sdkVersion: parsed?.data?.sdkVersion || null,
          macAddress: parsed?.data?.macAddress || null
        };

        const networkInfo = {
          ip: parsed?.data?.ip || null,
          ssid: parsed?.data?.ssid || null,
          rssi: parsed?.data?.rssi_dbm || null,
          channel: parsed?.data?.channel || null
        };

        // Формуємо summary з доступних даних
        const summaryParts = [
          deviceInfo.name,
          `IP: ${networkInfo.ip || 'Unknown'}`,
          networkInfo.rssi !== null ? `RSSI: ${networkInfo.rssi}dBm` : null
        ].filter(Boolean);

        return {
          id: f,
          time: parsed?.meta?.time || null,
          device: deviceInfo,
          network: networkInfo,
          summary: summaryParts.join(' '),
          // Додаємо сенсорні дані
          sensors: {
            lux: parsed?.data?.lux,
            temperature_aht: parsed?.data?.temperature_aht_c,
            humidity_aht: parsed?.data?.humidity_aht_pct,
            temperature_dht: parsed?.data?.temperature_dht_c,
            humidity_dht: parsed?.data?.humidity_dht_pct,
            battery: parsed?.data?.battery_v,
            uptime: parsed?.data?.uptime_ms
          }
        };
      } catch (e) {
        return { id: f, time: null, device: {}, network: {}, summary: '' };
      }
    }).sort((a,b) => (b.time || '').localeCompare(a.time || ''));

    // Calculate pagination
    const totalItems = list.length;
    const totalPages = Math.ceil(totalItems / limit);
    const paginatedList = list.slice(start, start + limit);

    res.json({
      items: paginatedList,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages
      }
    });
  } catch (e) {
    console.error('Failed to list uploads:', e);
    res.status(500).json({ error: 'failed to list uploads' });
  }
});

// API: get single upload detail
app.get('/api/uploads/:name', (req, res) => {
  const name = req.params.name;
  // prevent path traversal
  if (path.basename(name) !== name) return res.status(400).json({ error: 'invalid name' });
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    res.json(parsed);
  } catch (e) {
    console.error('Failed to read upload file:', e);
    res.status(500).json({ error: 'failed to read file' });
  }
});

// Server-Sent Events: clients can subscribe to updates (new/delete)
const sseClients = new Set();
function sendSseEvent(event, payload) {
  const msg = `event: ${event}\n` + `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (e) { console.error('SSE write error:', e); }
  }
}

app.get('/events', (req, res) => {
  // set headers for SSE
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders && res.flushHeaders();
  res.write(': connected\n\n');
  sseClients.add(res);
  req.on('close', () => { sseClients.delete(res); });
});

// DELETE all uploads
app.delete('/api/uploads', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(UPLOAD_DIR, file));
      }
    }
    console.log(`Deleted all upload files`);
    sendSseEvent('deleted_all', {});
    res.json({ ok: true });
  } catch (e) {
    console.error('Failed to delete all upload files:', e);
    res.status(500).json({ error: 'failed to delete all' });
  }
});

// DELETE an upload
app.delete('/api/uploads/:name', (req, res) => {
  const name = req.params.name;
  if (path.basename(name) !== name) return res.status(400).json({ error: 'invalid name' });
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  try {
    fs.unlinkSync(file);
    console.log(`Deleted upload file ${file}`);
    // notify SSE clients
    sendSseEvent('deleted', { id: name });
    res.json({ ok: true });
  } catch (e) {
    console.error('Failed to delete upload file:', e);
    res.status(500).json({ error: 'failed to delete' });
  }
});

const PINS_STATE_FILE = path.join(__dirname, 'pins.json');

// Endpoint to get the current state of all pins
app.get('/pinstate', (req, res) => {
  try {
    if (fs.existsSync(PINS_STATE_FILE)) {
      const state = fs.readFileSync(PINS_STATE_FILE, 'utf8');
      res.json(JSON.parse(state));
    } else {
      // Default state if file doesn't exist
      res.json({});
    }
  } catch (e) {
    console.error('Failed to read pins state:', e);
    res.status(500).json({ error: 'failed to read pins state' });
  }
});

// Endpoint to update the state of all pins
app.post('/api/pins', (req, res) => {
  try {
    const { pins } = req.body;
    fs.writeFileSync(PINS_STATE_FILE, JSON.stringify(pins), 'utf8');
    console.log(`Set pins state to ${JSON.stringify(pins)}`);
    res.json({ status: 'ok', pins });
  } catch (e) {
    console.error('Failed to write pins state:', e);
    res.status(500).json({ error: 'failed to write pins state' });
  }
});

// Endpoint to get the current state of a specific pin
app.get('/api/pins/:pin', (req, res) => {
  try {
    const pin = req.params.pin;
    if (fs.existsSync(PINS_STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(PINS_STATE_FILE, 'utf8'));
      res.json({ state: state[pin] || 0 });
    } else {
      // Default state if file doesn't exist
      res.json({ state: 0 });
    }
  } catch (e) {
    console.error(`Failed to read pin ${req.params.pin} state:`, e);
    res.status(500).json({ error: `failed to read pin ${req.params.pin} state` });
  }
});

// Створюємо мапування логічних пінів на реальні GPIO
const pinMapping = {
  '12': 12,
  '13': 13,
  '14': 14,
};

/**
 * Updates the state of a specific pin, saves it, and sends the command to the ESP.
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
    pins = JSON.parse(fs.readFileSync(PINS_STATE_FILE, 'utf8'));
  }

  pins[pinName] = state;
  fs.writeFileSync(PINS_STATE_FILE, JSON.stringify(pins, null, 2), 'utf8');
  console.log(`[Pin Control] Set pin ${pinName} state to ${state} in pins.json`);

  if (lastKnownIp) {
    const espUrl = `http://${lastKnownIp}/control?pin=${gpioPinNumber}&state=${state}`;
    console.log(`[Pin Control] Sending command to ESP: ${espUrl}`);
    try {
      const espResponse = await fetch(espUrl, { method: 'GET', timeout: 5000 });
      if (!espResponse.ok) {
        console.error(`[Pin Control] ESP returned status: ${espResponse.status}`);
      } else {
        console.log('[Pin Control] Successfully sent command to ESP.');
      }
    } catch (espError) {
      console.error(`[Pin Control] Failed to send command to ESP8266 at ${lastKnownIp}:`, espError.message);
    }
  } else {
    console.warn('[Pin Control] Cannot send command to ESP: IP address is unknown.');
  }
  return { status: 'ok', state, sentToEsp: !!lastKnownIp };
}


// Endpoint to update the state of a specific pin
app.post('/api/pins/:pin', async (req, res) => {
  try {
    const { state } = req.body;
    const result = await updatePinState(req.params.pin, state);
    res.json(result);
  } catch (e) {
    console.error(`[Pin Control] Failed to write pin ${req.params.pin} state:`, e);
    res.status(500).json({ error: `failed to write pin ${req.params.pin} state` });
  }
});

app.get('/chart', (req, res) => {
    return res.render('chart');
});

app.get('/settings', (req, res) => {
    return res.render('settings');
});

app.get('/api/history', (req, res) => {
    try {
        const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.endsWith('.json'));
        const history = files.map(f => {
            try {
                const raw = fs.readFileSync(path.join(UPLOAD_DIR, f), 'utf8');
                const parsed = JSON.parse(raw);
                return {
                    timestamp: parsed?.meta?.time || null,
                    ...parsed.data
                };
            } catch (e) {
                return null;
            }
        }).filter(Boolean).sort((a,b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
        res.json(history);
    } catch (e) {
        console.error('Failed to get history data for API:', e);
        res.status(500).json({ error: 'Failed to read history data' });
    }
});

// Global error handlers for uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Optionally exit: process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Print startup URLs including local and network address
const os = require('os');
function getLocalNetworkAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip internal (i.e. 127.0.0.1) and non-IPv4
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

const uploadDir = "./upload";
app.get("/files", (req, res) => {
  try {
    const files = fs.readdirSync(uploadDir);
    const links = files.map(f => `<li><a href="/upload/${f}">${f}</a></li>`).join("");
    res.send(`<h3>Вміст папки /upload</h3><ul>${links}</ul>`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Помилка при читанні папки");
  }
});

// Дозволяємо відкривати файли напряму
app.use("/upload", express.static(uploadDir));

// Bind explicitly to 0.0.0.0 so the server accepts connections from the LAN (e.g. ESP device).
app.listen(PORT, '0.0.0.0', () => {
  const localUrl = `http://localhost:${PORT}`;
  console.log(`ESP receiver listening on port ${PORT} (bound to 0.0.0.0)`);
  console.log(`Local: ${localUrl}`);

  const netAddrs = getLocalNetworkAddresses();
  if (netAddrs.length) {
    for (const addr of netAddrs) {
      console.log(`On your network: http://${addr}:${PORT}`);
    }
  } else {
    console.log('No non-internal IPv4 network interfaces detected');
  }
});

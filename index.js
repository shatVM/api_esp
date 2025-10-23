const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 80;

// Increase limit if payloads may be large
app.use(bodyParser.json({ limit: '256kb' }));

// Views and static assets (for frontend rendering)
const hbs = require('hbs');
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');
app.use(express.static(path.join(__dirname, 'public')));

// Register a simple helper to pretty-print JSON in templates
hbs.registerHelper('json', function(context) {
  try {
    return new hbs.handlebars.SafeString('<pre>' + JSON.stringify(context, null, 2) + '</pre>');
  } catch (e) {
    return '';
  }
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

app.post('/upload', (req, res) => {
  try {
    const data = req.body;
    console.log('Received upload from ESP at', new Date().toISOString());
    // Log a concise preview plus full JSON at debug level
    try {
      const preview = JSON.stringify(data).slice(0, 1000);
      // console.log('Upload preview:', preview + (preview.length >= 1000 ? '... (truncated)' : ''));
      // console.log('Full payload:', JSON.stringify(data, null, 2));
    } catch (jerr) {
      console.log('Failed to stringify upload payload:', jerr);
    }
    // Логуємо тіло запиту
    // console.log(`[${new Date().toISOString()}] Request body for ${req.method} ${req.originalUrl}:`);
    // console.log(JSON.stringify(data, null, 2));


    const outPath = path.join(__dirname, 'received.json');
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Saved received payload to ${outPath}`);

    // Also save each upload as its own file with metadata in upload/
    try {
      const id = Date.now().toString() + '-' + crypto.randomBytes(4).toString('hex');
      const filename = `${id}.json`;
      const filePath = path.join(UPLOAD_DIR, filename);
      const record = {
        meta: {
          id,
          time: new Date().toISOString(),
          ip: req.ip,
          method: req.method,
          url: req.originalUrl
        },
        data
      };
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
  console.log(`Saved upload record to ${filePath}`);
  // notify SSE clients about new upload
  try { 
    // Перетворюємо дані в потрібний формат
    const deviceInfo = {
      name: record.data?.device || 'Unknown Device',
      chipModel: 'ESP',
      cpuFreqMHz: null,
      flashSizeMB: null,
      sdkVersion: null,
      macAddress: null
    };

    const networkInfo = {
      ip: record.data?.ip || null,
      ssid: null,
      rssi: record.data?.rssi_dbm || null,
      channel: null
    };

    // Формуємо summary
    const summaryParts = [
      deviceInfo.name,
      `IP: ${networkInfo.ip || 'Unknown'}`,
      networkInfo.rssi !== null ? `RSSI: ${networkInfo.rssi}dBm` : null
    ].filter(Boolean);

    sendSseEvent('new', { 
      id: filename, 
      time: record.meta.time, 
      device: deviceInfo,
      network: networkInfo,
      summary: summaryParts.join(' '),
      sensors: {
        lux: record.data?.lux,
        temperature_aht: record.data?.temperature_aht_c,
        humidity_aht: record.data?.humidity_aht_pct,
        temperature_dht: record.data?.temperature_dht_c,
        humidity_dht: record.data?.humidity_dht_pct,
        battery: record.data?.battery_v,
        uptime: record.data?.uptime_ms
      }
    }); 
  } catch (e) { }
  // include filename in response
  return res.status(200).json({ status: 'ok', savedTo: 'received.json', uploadFile: filename });
    } catch (wfErr) {
      console.error('Failed to write upload file:', wfErr);
      return res.status(500).json({ status: 'error', message: 'Failed to save upload file' });
    }
  } catch (err) {
    console.error('Error handling /upload:', err);
    res.status(500).json({ status: 'error', message: err.message });
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

  return res.render('received', { exists: true, list });
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
          name: parsed?.data?.device || 'Unknown Device',
          chipModel: 'ESP',
          cpuFreqMHz: null,
          flashSizeMB: null,
          sdkVersion: null,
          macAddress: null
        };

        const networkInfo = {
          ip: parsed?.data?.ip || null,
          ssid: null,
          rssi: parsed?.data?.rssi_dbm || null,
          channel: null
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
    try { res.write(msg); } catch (e) { /* ignore write errors */ }
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

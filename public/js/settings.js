// settings.js - manage settings page interactions

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Toast helper
function ensureToastContainer() {
  let c = document.getElementById('toastContainer');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toastContainer';
    document.body.appendChild(c);
  }
  return c;
}

function showToast(msg, type = 'info', timeout = 3000) {
  const c = ensureToastContainer();
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, timeout);
}

// Validation
function isValidUrl(value) {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// Update the current time display in UTC+2
function updateCurrentTimeUTC2() {
  const el = document.getElementById('currentTime');
  if (!el) return;
  const now = new Date();
  // compute UTC ms and add +2 hours
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const tzDate = new Date(utcMs + 2 * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  const formatted = `${tzDate.getFullYear()}-${pad(tzDate.getMonth()+1)}-${pad(tzDate.getDate())} ${pad(tzDate.getHours())}:${pad(tzDate.getMinutes())}:${pad(tzDate.getSeconds())}`;
  el.textContent = `${formatted}`;
}

// Return ISO-like string with +02:00 timezone, e.g. 2025-11-25T12:27:14+02:00
function getIsoUtcPlus2() {
  const now = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const tzDate = new Date(utcMs + 2 * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${tzDate.getFullYear()}-${pad(tzDate.getMonth()+1)}-${pad(tzDate.getDate())}T${pad(tzDate.getHours())}:${pad(tzDate.getMinutes())}:${pad(tzDate.getSeconds())}+02:00`;
}

// Format server ISO like '2025-11-25T12:27:14+02:00' to 'HH:MM:SS DD-MM-YYYY'
function formatIsoToDisplay(iso) {
  if (!iso) return '—';
  try {
    // naive parse
    const datePart = iso.substring(0, 10); // YYYY-MM-DD
    const timePart = iso.substring(11, 19); // HH:MM:SS
    const y = datePart.substring(0,4);
    const m = datePart.substring(5,7);
    const d = datePart.substring(8,10);
    return `${timePart} ${d}-${m}-${y}`;
  } catch (e) {
    return iso;
  }
}

// WiFi item builder
function createWifiItem(item = { ssid: '', password: '', enabled: true }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'sensor-item wifi-item';
  wrapper.innerHTML = `
    <div class="flex-row">
      <input type="checkbox" class="wifi-enabled" ${item.enabled ? 'checked' : ''} title="Enable network" />
      <div class="flex-column wifi-inputs">
        <input class="form-control wifi-ssid" type="text" placeholder="SSID" value="${escapeHtml(item.ssid)}" />
        <input class="form-control wifi-pass" type="password" placeholder="Password" value="${escapeHtml(item.password)}" />
      </div>
      <div class="controls">
        <button class="btn btn-small info btn-up" type="button"><i data-lucide="chevron-up"></i></button>
        <button class="btn btn-small info btn-down" type="button"><i data-lucide="chevron-down"></i></button>
        <button class="btn btn-small danger btn-remove" type="button"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
  `;

  // mark as unsaved when changed
  wrapper.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => wrapper.classList.add('unsaved'));
    inp.addEventListener('change', () => wrapper.classList.add('unsaved'));
  });

  wrapper.querySelector('.btn-remove').addEventListener('click', () => wrapper.remove());
  wrapper.querySelector('.btn-up').addEventListener('click', () => moveItem(wrapper, -1));
  wrapper.querySelector('.btn-down').addEventListener('click', () => moveItem(wrapper, 1));
  // toggle .unactive on buttons when checkbox changes
  const cb = wrapper.querySelector('.wifi-enabled');
  function applyWifiEnabledState() {
    const enabled = !!cb.checked;
    const buttons = wrapper.querySelectorAll('.controls .btn');
    buttons.forEach(b => {
      if (!enabled) b.classList.add('unactive'); else b.classList.remove('unactive');
    });
  }
  cb.addEventListener('change', () => { wrapper.classList.toggle('unactive', !cb.checked); applyWifiEnabledState(); wrapper.classList.add('unsaved'); });
  // initial state
  applyWifiEnabledState();
  // render icons if lucide is available - target only this item's icons
  if (window.lucide && typeof lucide.createIcons === 'function') {
    // Use setTimeout to ensure icons are rendered after DOM insertion
    setTimeout(() => {
      const icons = wrapper.querySelectorAll('[data-lucide]');
      if (icons.length > 0) lucide.createIcons();
    }, 0);
  }

  return wrapper;
}

// Server address item builder
function createServerItem(value = '') {
  const wrapper = document.createElement('div');
  wrapper.className = 'sensor-item server-item';
  wrapper.innerHTML = `
  
    <input type="checkbox" class="server-enabled" checked title="Enable server" />
    <input class="form-control address-input" type="text" placeholder="https://your.server/api" value="${escapeHtml(value)}" />
    <div class="controls">
      <button class="btn btn-small info btn-up" type="button"><i data-lucide="chevron-up"></i></button>
      <button class="btn btn-small info btn-down" type="button"><i data-lucide="chevron-down"></i></button>
      <button class="btn btn-small danger btn-remove-address" type="button"><i data-lucide="trash-2"></i></button>
    </div>
  `;

  const input = wrapper.querySelector('.address-input');
  input.addEventListener('input', () => {
    wrapper.classList.add('unsaved');
    if (input.value && !isValidUrl(input.value)) {
      input.classList.add('invalid');
    } else {
      input.classList.remove('invalid');
    }
  });

  wrapper.querySelector('.btn-remove-address').addEventListener('click', () => wrapper.remove());
  wrapper.querySelector('.btn-up').addEventListener('click', () => moveItem(wrapper, -1));
  wrapper.querySelector('.btn-down').addEventListener('click', () => moveItem(wrapper, 1));

  const cb = wrapper.querySelector('.server-enabled');
  function applyServerEnabledState() {
    const enabled = !!cb.checked;
    const buttons = wrapper.querySelectorAll('.controls .btn');
    buttons.forEach(b => {
      if (!enabled) b.classList.add('unactive'); else b.classList.remove('unactive');
    });
  }
  cb.addEventListener('change', () => { wrapper.classList.toggle('unactive', !cb.checked); applyServerEnabledState(); wrapper.classList.add('unsaved'); });
  applyServerEnabledState();

  // render icons if lucide is available - target only this item's icons
  if (window.lucide && typeof lucide.createIcons === 'function') {
    // Use setTimeout to ensure icons are rendered after DOM insertion
    setTimeout(() => {
      const icons = wrapper.querySelectorAll('[data-lucide]');
      if (icons.length > 0) lucide.createIcons();
    }, 0);
  }

  return wrapper;
}

function moveItem(el, delta) {
  const parent = el.parentElement;
  if (!parent) return;
  const children = Array.from(parent.children);
  const idx = children.indexOf(el);
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= children.length) return;
  if (delta < 0) parent.insertBefore(el, children[newIdx]); else parent.insertBefore(el, children[newIdx + 1] ? children[newIdx + 1] : null);
  // mark list as changed
  parent.classList.add('unsaved-list');
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Failed to load config');
    const cfg = await res.json();

    document.getElementById('enableAutoLight').checked = !!cfg.enableAutoLight;
    document.getElementById('enableLightThreshold').checked = !!cfg.enableLightThreshold;
    document.getElementById('lightThreshold').value = cfg.lightThreshold || '';
    document.getElementById('uploadIntervalSeconds').value = cfg.uploadIntervalSeconds || '';
    // auto-light schedule
    if (cfg.autoLightStartTime) document.getElementById('autoLightStartTime').value = cfg.autoLightStartTime;
    if (cfg.autoLightEndTime) document.getElementById('autoLightEndTime').value = cfg.autoLightEndTime;
    // last saved time
    const lastSavedEl = document.getElementById('lastSavedTime');
    if (lastSavedEl) lastSavedEl.textContent = formatIsoToDisplay(cfg.lastSavedLocalTime || cfg.currentTime) || '—';
    document.getElementById('deviceName').value = cfg.deviceName || '';

    // wifi list
    const wifiList = document.getElementById('wifiList');
    wifiList.innerHTML = '';
    const networks = Array.isArray(cfg.wifi) ? cfg.wifi : [];
    if (networks.length === 0) {
      wifiList.appendChild(createWifiItem({ ssid: '', password: '', enabled: true }));
    } else {
      networks.forEach(n => wifiList.appendChild(createWifiItem(n)));
    }

    // servers list
    const list = document.getElementById('sendAddressesList');
    list.innerHTML = '';
    const addresses = Array.isArray(cfg.sendAddresses) ? cfg.sendAddresses : [];
    if (addresses.length === 0) list.appendChild(createServerItem(''));
    addresses.forEach(a => list.appendChild(createServerItem(a)));

    // MQTT settings
    if (cfg.mqtt) {
      document.getElementById('mqttEnabled').checked = !!cfg.mqtt.enabled;
      document.getElementById('mqttBrokerUrl').value = cfg.mqtt.brokerUrl || '';
      document.getElementById('mqttUsername').value = cfg.mqtt.username || '';
      document.getElementById('mqttPassword').value = cfg.mqtt.password || '';
      document.getElementById('mqttBaseTopic').value = cfg.mqtt.baseTopic || '';
    }

  } catch (e) {
    console.error('loadConfig error', e);
    showToast('Помилка завантаження конфігу', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // ensure toast area exists
  ensureToastContainer();
  loadConfig();

  // Start periodic update: update current-time display and send currentTime to server every second
  updateCurrentTimeUTC2();
  // send immediately and then set interval
  (async function sendCurrentTimeOnce() {
    try {
      const iso = getIsoUtcPlus2();
      await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentTime: iso }) });
    } catch (e) {
      console.error('Failed to send currentTime update', e);
    }
  })();
  setInterval(() => {
    updateCurrentTimeUTC2();
    const iso = getIsoUtcPlus2();
    // fire-and-forget POST to update currentTime on server (written to config)
    fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentTime: iso }) }).catch(e => console.error('currentTime POST failed', e));
  }, 1000);
  // Update hidden input used by form (if present)
  setInterval(() => {
    const el = document.getElementById('currentTimeHidden');
    if (el) el.value = getIsoUtcPlus2();
  }, 1000);

  document.getElementById('addAddressBtn').addEventListener('click', () => {
    document.getElementById('sendAddressesList').appendChild(createServerItem(''));
  });

  document.getElementById('addWifiBtn').addEventListener('click', () => {
    document.getElementById('wifiList').appendChild(createWifiItem({ ssid: '', password: '', enabled: true }));
  });

  const cfgForm = document.getElementById('configForm');
  if (cfgForm) {
    cfgForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {};
      payload.enableAutoLight = !!document.getElementById('enableAutoLight').checked;
      payload.enableLightThreshold = !!document.getElementById('enableLightThreshold').checked;
      payload.lightThreshold = Number(document.getElementById('lightThreshold').value) || 0;
      payload.uploadIntervalSeconds = Number(document.getElementById('uploadIntervalSeconds').value) || 0;
      // include start/end times if present
      const start = document.getElementById('autoLightStartTime').value;
      const end = document.getElementById('autoLightEndTime').value;
      if (start) payload.autoLightStartTime = start;
      if (end) payload.autoLightEndTime = end;

      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Save failed: ' + res.status);
        const data = await res.json();
        // update last-saved time shown in UI (server returns config)
        if (data && data.config && data.config.lastSavedLocalTime) {
          const lastSavedEl2 = document.getElementById('lastSavedTime');
          if (lastSavedEl2) lastSavedEl2.textContent = data.config.lastSavedLocalTime;
        }
        // clear unsaved markers for auto section
        document.querySelectorAll('#AutoControlSettings .unsaved').forEach(el => el.classList.remove('unsaved'));
      } catch (err) {
        console.error('Failed to save auto config', err);
        showToast('Помилка при збереженні авто-настроєнь: ' + err.message, 'error');
      }
    });
  }

  // General form (deviceName, wifi, servers)
  const generalForm = document.getElementById('generalForm');
  if (generalForm) {
    generalForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      // validate server URLs
      const serverInputs = Array.from(document.querySelectorAll('.server-item .address-input'));
      for (const inp of serverInputs) {
        if (inp.value && !isValidUrl(inp.value)) {
          inp.classList.add('invalid');
          showToast('Невірний URL в списку серверів: ' + inp.value, 'error');
          return;
        }
      }

      const payload = {};
      payload.deviceName = document.getElementById('deviceName').value || '';

      // wifi list
      const wifiEls = Array.from(document.querySelectorAll('#wifiList .wifi-item'));
      payload.wifi = wifiEls.map(w => ({
        ssid: w.querySelector('.wifi-ssid').value || '',
        password: w.querySelector('.wifi-pass').value || '',
        enabled: !!w.querySelector('.wifi-enabled').checked
      }));

      // addresses
      const addrEls = Array.from(document.querySelectorAll('.server-item'));
      payload.sendAddresses = addrEls.map(s => s.querySelector('.address-input').value).filter(v => v && v.trim());

      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Save failed: ' + res.status);
        const data = await res.json();
        showToast('Загальні налаштування збережено', 'success');
        // clear unsaved markers in general section
        document.querySelectorAll('#generalForm .unsaved').forEach(el => el.classList.remove('unsaved'));
        document.querySelectorAll('#wifiList .unsaved-list').forEach(el => el.classList.remove('unsaved-list'));
      } catch (err) {
        console.error('Failed to save general config', err);
        showToast('Помилка при збереженні загальних налаштувань: ' + err.message, 'error');
      }
    });
  }

  // MQTT form
  const mqttForm = document.getElementById('mqttForm');
  if (mqttForm) {
    mqttForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        mqtt: {
          enabled: !!document.getElementById('mqttEnabled').checked,
          brokerUrl: document.getElementById('mqttBrokerUrl').value || '',
          username: document.getElementById('mqttUsername').value || '',
          password: document.getElementById('mqttPassword').value || '',
          baseTopic: document.getElementById('mqttBaseTopic').value || '',
        }
      };

      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Save failed: ' + res.status);
        await res.json();
        showToast('MQTT налаштування збережено', 'success');
      } catch (err) {
        console.error('Failed to save MQTT config', err);
        showToast('Помилка при збереженні MQTT налаштувань: ' + err.message, 'error');
      }
    });
  }
});


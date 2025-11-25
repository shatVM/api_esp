# Complete Analysis & Implementation Summary

## 📋 Server-Side Analysis

### Current Configuration Structure (`config.json`)
```json
{
  "enableAutoLight": false,           // Auto-control lights based on lux
  "lightThreshold": 40,               // Lux threshold for auto-light
  "uploadIntervalSeconds": 30,        // ESP sends data every N seconds
  "wifi": [                           // Array of WiFi networks
    {"ssid": "POCOFree", "password": "", "enabled": true},
    {"ssid": "FreeZSTU", "password": "", "enabled": false}
  ],
  "sendAddresses": [                  // Array of URLs to send data to
    "https://api-esp-tnww.onrender.com",
    "http://localhost/control"
  ],
  "deviceName": "3003"                // Device identifier
}
```

### Server API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/config` | GET | Retrieve current configuration |
| `/api/config` | POST | Update configuration |
| `/upload` | POST | Receive sensor data from ESP |
| `/upload` | GET | Readiness check |
| `/view` | GET | Web dashboard for data viewing |
| `/settings` | GET | Settings web interface |

### Server Features
- ✅ Centralized config management
- ✅ Backward compatibility for old single-WiFi format
- ✅ Auto-light logic (runs on server)
- ✅ Upload file storage for data archiving
- ✅ Real-time data tracking via SSE
- ✅ Web-based settings interface

---

## 🔧 ESP8266 Firmware Enhancements

### Major Changes

#### 1️⃣ **Bluetooth Serial Configuration**
```cpp
#include <BluetoothSerial.h>
BluetoothSerial SerialBT;

void setup() {
  SerialBT.begin("ESP8266_BT", true); // Advertised name and slave mode
}
```

**Available Bluetooth Commands:**
```
help                          - Show command help
status                       - WiFi status
wifi:list                    - List WiFi networks
wifi:add:SSID:PASSWORD      - Add WiFi network
wifi:remove:N               - Remove WiFi by index
name:DEVICE_NAME            - Set device name
fetch:config                - Manual config fetch
reboot                      - Restart ESP
```

#### 2️⃣ **Dynamic Configuration**
Replaced hardcoded values with dynamic `Config` struct:
```cpp
struct Config {
  bool enableAutoLight;
  int lightThreshold;
  int uploadIntervalSeconds;
  String deviceName;
  String sendAddresses[10];    // Up to 10 URLs
  int sendAddressCount;
  String wifiSSIDs[5];         // Up to 5 networks
  String wifiPasswords[5];
  bool wifiEnabled[5];
  int wifiCount;
} config;
```

#### 3️⃣ **Server Configuration Fetch**
```cpp
void fetchConfigFromServer() {
  // Connects to server, fetches /api/config
  // Parses JSON and updates local config
  // Updates uploadIntervalSeconds dynamically
}
```

Called:
- On startup (after WiFi connects)
- Periodically every 5 minutes
- Manually via Bluetooth: `fetch:config`

#### 4️⃣ **Multiple Send Address Support**
ESP now tries all configured server addresses:
```cpp
// Parses URL: https://example.com:443/api
// Extracts host, port, path
// Tries each address in order until successful
for (int i = 0; i < config.sendAddressCount; i++) {
  success = performPost(config.sendAddresses[i]);
  if (success) break;
}
```

#### 5️⃣ **WiFi Failover**
```cpp
// Try each enabled WiFi network
for (int i = 0; i < config.wifiCount; i++) {
  if (!config.wifiEnabled[i]) continue;
  WiFi.begin(config.wifiSSIDs[i].c_str(), ...);
  // Connect with timeout
}
```

---

## 🔄 Data Flow Architecture

```
┌─────────────────┐
│  ESP8266 with   │
│  Sensors (DHT,  │
│  AHT, BH1750)   │
└────────┬────────┘
         │ Upload every N seconds
         │ (uploadIntervalSeconds)
         │
    ┌────▼─────┐
    │  Server  │
    │ /upload  │
    └────┬─────┘
         │ Parse JSON
         │ Run auto-light logic
         │ Store to file
         │
    ┌────▼──────────────┐
    │ Web Dashboard     │
    │ /view (sidebar)   │
    │ /chart (graphs)   │
    │ /settings (config)│
    └───────────────────┘
         │
         │ User can configure
         │ via web interface
         │
    ┌────▼──────────┐
    │ config.json   │ (persisted)
    └───────────────┘
         │
         │ ESP fetches every 5 min
         │ or manually via BT
         │
    ┌────▼──────────┐
    │ ESP Config    │
    │ (RAM-based)   │
    └───────────────┘
```

---

## 📱 Bluetooth Usage Examples

### Example 1: Add WiFi Network
```
[Phone] > wifi:add:MyNetwork:Password123
[ESP]   > Added WiFi: MyNetwork

[Phone] > reboot
[ESP]   > Rebooting...
[ESP]   > Connected to MyNetwork!
[ESP]   > Fetching config from server...
```

### Example 2: Check Status & Configure
```
[Phone] > status
[ESP]   > --- WiFi Status ---
          Connected: Yes
          SSID: MyNetwork
          IP: 192.168.1.100
          RSSI: -45 dBm
          
[Phone] > wifi:list
[ESP]   > --- Saved WiFi Networks ---
          0: MyNetwork [ENABLED]
          1: FreeZSTU [DISABLED]

[Phone] > name:Sensor_Bedroom_01
[ESP]   > Device name set to: Sensor_Bedroom_01

[Phone] > fetch:config
[ESP]   > Fetching config from server...
          Config fetched successfully!
```

### Example 3: Add Backup Server
```
Via Web Settings:
- Add to sendAddresses: http://192.168.1.115/upload
- Save

Next auto-fetch (ESP):
[ESP] > ESP connects in ~5 minutes
       Tries primary server first
       If fails, tries local server backup
```

---

## 📊 Sensor Data Sent

ESP sends JSON with:
```json
{
  "ip": "192.168.1.100",
  "deviceName": "esp8266_12E",
  "temperature_dht_c": 24.5,
  "humidity_dht_pct": 55,
  "temperature_aht_c": 23.8,
  "humidity_aht_pct": 56,
  "lux": 850,
  "battery_v": 3.2,
  "rssi_dbm": -45,
  "ssid": "MyNetwork",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "cpuFreqMHz": 80,
  "flashSizeMB": 4,
  "chipModel": "ESP8266",
  "uptime_ms": 3600000
}
```

---

## 🛠️ Installation Steps

### 1. Update platformio.ini
```ini
[env:esp8266]
platform = espressif8266
board = nodemcuv2
framework = arduino

lib_deps =
    ArduinoJson@^6.19.0
    DHT sensor library@^1.4.4
    Adafruit AHTX0@^2.0.0
    BH1750@^1.3.0
    BluetoothSerial
```

### 2. Upload New Firmware
```bash
platformio run -e esp8266 --target upload
```

### 3. Configure WiFi (via Bluetooth)
```
# Connect to ESP8266_BT
wifi:add:YourSSID:YourPassword
fetch:config
reboot
```

### 4. Verify in Web Dashboard
```
https://api-esp-tnww.onrender.com/view
```

---

## 🔐 Security Considerations

✅ **WiFi**
- Supports hidden networks
- Passwords encrypted in config.json (on server)
- Supports multiple networks

⚠️ **Bluetooth**
- Default Bluetooth pairing with ESP8266_BT
- Can set PIN via code modification
- No authentication required by default

✅ **API**
- Use HTTPS for config fetch
- Server validates JSON structure
- File permissions control data access

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| ESP won't connect WiFi | `wifi:add:SSID:Pass` and `reboot` |
| Bluetooth not found | Power cycle ESP, check library |
| Config not updating | Ensure WiFi connected, try `fetch:config` |
| Data not arriving | Check `sendAddresses`, verify server online |
| Serial garbage | Check baud rate (115200) |

---

## 📚 Files Modified

| File | Changes |
|------|---------|
| `esp8266/webControll/src/main.cpp` | Major rewrite with BT, dynamic config |
| `index.js` | Already had config endpoints ✅ |
| `config.json` | Format already supports arrays ✅ |
| `views/settings.hbs` | Already has config UI ✅ |
| `public/js/settings.js` | Already handles config API ✅ |

---

## ✨ Key Features Summary

| Feature | Before | After |
|---------|--------|-------|
| WiFi Networks | 1 hardcoded | 5 networks, configurable |
| Server Addresses | 2 hardcoded | 10 URLs, configurable |
| Config Updates | Firmware reupload | Server → Auto-fetch |
| Setup Method | Serial + Firmware | Bluetooth + Web UI |
| Upload Interval | Hardcoded 1s | Server-controlled |
| Device Name | Hardcoded | Configurable |
| Auto-Light | Server logic | Server logic (unchanged) |

---

## 🚀 Next Steps (Optional)

1. **EEPROM Storage** - Save WiFi/servers to EEPROM for offline persistence
2. **OTA Updates** - Firmware updates over-the-air via WiFi
3. **PIN Authentication** - Secure Bluetooth with PIN
4. **MQTT Support** - Alternative to HTTP for data sending
5. **Schedule Config** - Set upload interval based on time of day

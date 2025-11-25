# ESP8266 Firmware Updates - Analysis & Changes

## Server-Side Changes Analysis

### Config Structure (config.json)
The server now manages a centralized configuration with the following fields:
- **enableAutoLight**: Boolean to enable auto-light control based on lux threshold
- **lightThreshold**: Light level (lux) threshold for auto-light trigger
- **uploadIntervalSeconds**: Data upload interval in seconds
- **wifi**: Array of networks with structure `{ ssid, password, enabled }`
- **sendAddresses**: Array of server URLs to send sensor data to
- **deviceName**: Device identifier (used by ESP for identification)

### Server API Endpoints
- `GET /api/config` - Retrieve current configuration
- `POST /api/config` - Update configuration (with backward compatibility)
- `POST /upload` - Receive sensor data from ESP with auto-light logic

## ESP8266 Firmware Changes

### New Features Added

#### 1. **Bluetooth Serial Configuration**
- Added BluetoothSerial library for wireless setup
- ESP now advertises as "ESP8266_BT" 
- Commands available via Bluetooth terminal (e.g., Serial Monitor in Arduino IDE):

**Bluetooth Commands:**
```
help                              - Show all available commands
status                           - Display WiFi connection status
wifi:list                        - List saved WiFi networks
wifi:add:SSID:PASSWORD          - Add new WiFi network
wifi:remove:N                   - Remove WiFi network by index
name:DEVICE_NAME                - Set device name
fetch:config                    - Manually fetch config from server
reboot                          - Restart the ESP
```

**Example Usage:**
```
wifi:add:MySSID:MyPassword
wifi:add:SecondNetwork:Password123
fetch:config
name:MySensor_001
```

#### 2. **Dynamic Configuration Management**
- Replaced hardcoded WiFi/server settings with dynamic config structure
- Config fetched from server on startup and every 5 minutes
- Supports up to 5 WiFi networks and 10 send addresses
- Fallback to default config if server is unreachable

#### 3. **Multiple Send Address Support**
- Instead of hardcoded public/local servers, ESP now sends to all configured addresses
- Automatically parses URLs to extract host, port, and path
- Supports both HTTP and HTTPS protocols
- Tries each address until successful

#### 4. **WiFi Failover**
- Automatically tries all enabled WiFi networks on startup
- Can configure multiple networks for redundancy
- Easy add/remove networks via Bluetooth without firmware reupload

#### 5. **Dynamic Upload Interval**
- Upload frequency now controlled from server
- Changes applied immediately after config fetch
- Stored in milliseconds internally

### Configuration Flow

```
ESP Startup
    ↓
Default config loaded (1 network, 1 server)
    ↓
Try to connect to first enabled WiFi
    ↓
If connected → Fetch latest config from server
             → Update WiFi networks, servers, device name
             → Start sending data
    ↓
If not connected → Show Bluetooth message
                 → User can configure via Bluetooth
                 → Manual fetch:config command
```

### Dynamic Config Structure in ESP

```cpp
struct Config {
  bool enableAutoLight;              // Auto-light feature enabled
  int lightThreshold;                // Lux threshold
  int uploadIntervalSeconds;         // How often to send data
  String deviceName;                 // Device identifier
  String sendAddresses[10];          // Up to 10 server URLs
  int sendAddressCount;
  String wifiSSIDs[5];              // Up to 5 WiFi networks
  String wifiPasswords[5];
  bool wifiEnabled[5];
  int wifiCount;
};
```

### Data Sending

ESP now:
1. Collects sensor data (DHT, AHT, BH1750, battery, network info)
2. Serializes to JSON
3. Tries all configured send addresses until successful
4. Parses URLs dynamically (supports various formats)

### Server Response Integration

After successful upload, ESP:
- Receives `uploadIntervalSeconds` from server response
- Updates local `UPLOAD_INTERVAL` variable
- Fetches pin states for auto-control

### Benefits

✅ **No firmware recompilation** needed to change WiFi or servers  
✅ **Centralized management** via web interface  
✅ **Wireless configuration** via Bluetooth  
✅ **Redundancy** with multiple WiFi networks and send addresses  
✅ **Auto-updates** - config synced every 5 minutes  
✅ **Easy debugging** via Bluetooth terminal  
✅ **Fallback support** for offline scenarios  

### Required Libraries

Add to `platformio.ini`:
```ini
lib_deps =
    ArduinoJson
    DHT sensor library
    Adafruit AHTx0
    BH1750
    BluetoothSerial (built-in for ESP32)
```

For ESP8266, use `bluetooth` or compatible library.

### Troubleshooting

**Can't connect to WiFi?**
- Use Bluetooth: `status` command to check connection
- Add network: `wifi:add:SSID:Password`
- Manual fetch: `fetch:config`

**Config not updating?**
- Check server URL in sendAddresses
- Verify uploadIntervalSeconds in server config
- Use `fetch:config` via Bluetooth to force update

**Bluetooth not working?**
- Ensure BluetoothSerial library is installed
- Check ESP is advertising "ESP8266_BT"
- Use mobile app or Arduino Serial Monitor to connect

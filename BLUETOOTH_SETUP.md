# ESP8266 Bluetooth Configuration Guide

## Quick Start

### Step 1: Initial Setup (Without Bluetooth)
The ESP starts with these defaults:
```
WiFi: FreeZSTU (no password), enabled
Server: https://api-esp-tnww.onrender.com
Device Name: esp8266_12E
Upload Interval: 1 second
```

### Step 2: Connect via Bluetooth
1. Install Bluetooth app on phone (e.g., "Serial Bluetooth Terminal")
2. Search for "ESP8266_BT" and pair (no PIN needed, or 0000)
3. Open the app and connect to ESP8266_BT

### Step 3: Configure via Bluetooth Commands

#### Check Status
```
status
```
Output:
```
--- WiFi Status ---
Connected: Yes
SSID: FreeZSTU
IP: 192.168.1.100
RSSI: -45 dBm
-------------------
```

#### List WiFi Networks
```
wifi:list
```
Output:
```
--- Saved WiFi Networks ---
0: FreeZSTU [ENABLED]
1: POCOFree [DISABLED]
---------------------------
```

#### Add WiFi Network
```
wifi:add:MyNetwork:MyPassword123
```

#### Remove WiFi Network
```
wifi:remove:1
```
(Removes network at index 1)

#### Set Device Name
```
name:MyDevice_01
```

#### Fetch Latest Config from Server
```
fetch:config
```
This downloads:
- WiFi networks
- Server addresses
- Upload interval
- Auto-light settings
- Device name

#### Reboot Device
```
reboot
```

### Step 4: Verify Configuration from Web

1. Go to: `https://api-esp-tnww.onrender.com/view`
2. Look for your device in the sidebar
3. Check sensor data is arriving

## Configuration Priority

1. **At Startup**: Loads defaults (hardcoded)
2. **On WiFi Connect**: Fetches server config
3. **Periodic**: Syncs with server every 5 minutes
4. **Via Bluetooth**: Immediate updates

## Server Configuration (Web Interface)

Visit settings page at `/settings`:
1. Set WiFi networks (SSID, password)
2. Add server addresses (URLs where data is sent)
3. Set device name
4. Configure auto-light threshold
5. Set upload interval

All changes are sent to ESP within 5 minutes automatically.

## Troubleshooting

### ESP doesn't respond to Bluetooth
- Check Bluetooth is enabled on phone
- Look for "ESP8266_BT" in Bluetooth devices
- If not found, reset ESP (power cycle)
- Check BluetoothSerial library is installed

### WiFi connection fails
- Use `wifi:add:SSID:Password` to add correct network
- Use `wifi:remove:INDEX` to remove wrong ones
- Reboot: `reboot`
- Check SSID spelling and password exactly

### Can't fetch config
- Ensure WiFi is connected first
- Check server is online (visit website)
- Try `fetch:config` command manually
- Check sendAddresses in server config

### Device name not updating
- Use `name:NewName` via Bluetooth
- Or set in web settings
- Verify with next data upload to server

## Data Flow

```
ESP8266 (with sensors)
    ↓ (sends every uploadIntervalSeconds)
Server (/upload endpoint)
    ↓ (stores in upload/ directory)
Web Dashboard (/view page)
    ↓ (displays latest data)
User can view sensor readings & adjust settings
```

## Important Notes

⚠️ **Bluetooth vs Serial Monitor**
- Use Serial Monitor for debugging (USB cable)
- Use Bluetooth for wireless configuration
- Both work simultaneously

⚠️ **WiFi Network Order**
- ESP tries networks in order from index 0
- Only tries "enabled" networks
- First successful connection is used

⚠️ **Server Addresses Format**
- Must include protocol: `https://` or `http://`
- Can include port: `https://example.com:8443/api`
- All enabled addresses are tried in order

⚠️ **Auto-Light Logic**
- Runs on server side, not ESP
- Triggers when `lux < lightThreshold`
- Controls pin12 automatically when enabled

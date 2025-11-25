# ESP8266 Bluetooth Commands - Quick Reference

## Connection
```
Device Name: ESP8266_BT
No PIN required (or use 0000 if prompted)
Use any Bluetooth Serial Terminal app
```

## Command Format
```
command [parameters]
All commands are case-sensitive
Most WiFi commands use colon (:) as delimiter
```

## Available Commands

### Status & Information
```
help              Display this help menu
status            Show WiFi connection status (SSID, IP, RSSI)
```

### WiFi Management
```
wifi:list                        List all saved WiFi networks with status
wifi:add:SSID:PASSWORD          Add new WiFi network (max 5)
wifi:remove:N                   Remove WiFi network by index N (0-4)
```

### Device Settings
```
name:DEVICE_NAME                Set device name (appears in data)
```

### Configuration
```
fetch:config                    Manually fetch config from server
                               (WiFi networks, servers, intervals)
```

### System
```
reboot                         Restart the ESP device
```

## Examples

### Add WiFi Network
```
Input:  wifi:add:MyNetwork:MyPassword123
Output: Added WiFi: MyNetwork
```

### Add Multiple Networks
```
wifi:add:Network1:Pass1
wifi:add:Network2:Pass2
wifi:add:Network3:Pass3
```

### Check Current Configuration
```
Input:  status
Output: --- WiFi Status ---
        Connected: Yes
        SSID: MyNetwork
        IP: 192.168.1.100
        RSSI: -45 dBm
        -------------------

Input:  wifi:list
Output: --- Saved WiFi Networks ---
        0: Network1 [ENABLED]
        1: Network2 [ENABLED]
        2: Network3 [DISABLED]
        ---------------------------
```

### Configure & Connect
```
wifi:add:HomeNetwork:MyPassword
wifi:remove:1
name:Living_Room_Sensor
reboot
```

### Get Help
```
Input:  help
Output: === ESP8266 Bluetooth Commands ===
        help - Show all available commands
        status - Show current WiFi status
        ... (full list)
        =====================================
```

## Configuration via Web UI

While Bluetooth is for wireless setup, use the web interface for more complex settings:
```
https://api-esp-tnww.onrender.com/settings

Settings available:
- AutoLight: Enable/disable and set lux threshold
- WiFi Networks: Add/edit/remove with enabled toggle
- Server Addresses: Add multiple URLs for data sending
- Device Name: Identifier for the ESP
- Upload Interval: How often to send data
```

## Data Flow After Configuration

```
1. Configure WiFi via Bluetooth: wifi:add:SSID:PASS
2. Reboot: reboot
3. ESP connects to network
4. ESP fetches config from server
5. ESP starts sending sensor data
6. View on web dashboard: /view page
```

## Troubleshooting Commands

### ESP Not Responding
```
Reboot: reboot
Then reconnect Bluetooth
```

### Check If Connected
```
status
(should show "Connected: Yes" and IP address)
```

### Verify WiFi Networks Saved
```
wifi:list
(shows all networks and their enabled status)
```

### Force Config Update from Server
```
fetch:config
(This downloads latest WiFi, servers, settings)
```

## Advanced: Serial Monitor Integration

You can also use **Serial Monitor** (connected via USB) instead of Bluetooth:
- Same commands work
- Baud rate: **115200**
- Better for debugging
- Shows more verbose output

Serial Monitor + Bluetooth both work simultaneously.

## Limits

| Item | Max | Unit |
|------|-----|------|
| WiFi Networks | 5 | networks |
| Server Addresses | 10 | URLs |
| Device Name | 64 | characters |
| WiFi SSID | 32 | characters |
| WiFi Password | 64 | characters |
| Upload Interval | 65535 | seconds |

## Power Tips

💡 **After WiFi Add:**
```
wifi:add:NewNetwork:Password
reboot
```
Always reboot after WiFi changes for ESP to connect.

💡 **After Server Config Update:**
```
fetch:config
```
Manually fetch to get latest settings immediately (auto-fetches every 5 min anyway).

💡 **Check Device Name in Data:**
Visit `/view` page and look at "deviceName" field in latest sensor data.

💡 **Multiple Protocols Supported:**
```
Server with HTTPS: https://example.com:443/api
Server with HTTP:  http://192.168.1.1:80/api
Custom paths:      https://example.com/api/esp/upload
```

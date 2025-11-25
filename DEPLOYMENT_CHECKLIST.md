# Implementation Checklist & Deployment Guide

## ✅ What's Been Done

### Server Analysis & Existing Features ✓
- [x] Analyzed `config.json` structure with WiFi array and sendAddresses
- [x] Reviewed Express.js `/api/config` endpoints (GET/POST)
- [x] Confirmed config persistence to file
- [x] Auto-light logic on server side already working
- [x] Web settings UI in place at `/settings`
- [x] Data storage in `upload/` directory

### ESP8266 Firmware Enhancements ✓
- [x] Added BluetoothSerial support
- [x] Implemented dynamic Config struct (wifi, servers, device name)
- [x] Created Bluetooth command handler with 8+ commands
- [x] Added `fetchConfigFromServer()` function
- [x] Updated `sendDataToServer()` to use multiple addresses
- [x] Implemented WiFi failover (tries all enabled networks)
- [x] Added periodic config fetch (every 5 minutes)
- [x] Dynamic upload interval from server
- [x] Modified setup() for config-based WiFi
- [x] Enhanced loop() for Bluetooth and periodic tasks
- [x] Full JSON parsing with ArduinoJson

### Documentation ✓
- [x] Created `ESP_CHANGES.md` - Technical overview
- [x] Created `BLUETOOTH_SETUP.md` - User guide
- [x] Created `IMPLEMENTATION_SUMMARY.md` - Complete details
- [x] Created `QUICK_REFERENCE.md` - Command cheat sheet
- [x] Created `platformio_updated.ini` - Library configuration

---

## 📋 Deployment Steps

### Step 1: Prepare Environment
```bash
cd esp8266/webControll/
# Check platformio.ini has these lib_deps:
#   ArduinoJson
#   DHT sensor library
#   Adafruit AHTX0
#   BH1750
#   BluetoothSerial
```

### Step 2: Compile Firmware
```bash
platformio run -e esp8266
# Should complete without errors
# Binary saved to .pio/build/esp8266/firmware.bin
```

### Step 3: Upload to ESP8266
```bash
platformio run -e esp8266 --target upload
# Monitor output for success
# Watch for Serial Monitor output at 115200 baud
```

### Step 4: Verify Initial Boot
Monitor serial output:
```
ESP8266 Starting...
Bluetooth initialized. Waiting for connection...
Attempting to connect to: FreeZSTU
Connected!
IP Address: 192.168.1.XXX
Periodic config fetch...
Config fetched successfully!
ESP Web Server started...
```

### Step 5: Configure via Bluetooth
1. Install Bluetooth Serial app on phone
2. Search for "ESP8266_BT" and connect
3. Send commands:
   ```
   help              (see all commands)
   status            (verify connection)
   wifi:list         (show current networks)
   fetch:config      (get server settings)
   ```

### Step 6: Verify in Web Dashboard
```
https://api-esp-tnww.onrender.com/view
# Should see ESP device in sidebar
# Should see latest sensor data (DHT, AHT, BH1750)
```

### Step 7: Test Server Communication
Via web settings:
1. Add WiFi network (if needed): Settings → WiFi
2. Add send address: Settings → Servers
3. Verify ESP fetches settings within 5 minutes

---

## 🔍 Testing Checklist

### Bluetooth Functionality
- [ ] Phone connects to ESP8266_BT
- [ ] `help` command shows all options
- [ ] `status` shows connection info
- [ ] `wifi:list` shows saved networks
- [ ] `wifi:add:TestSSID:TestPass` adds network
- [ ] `wifi:remove:0` removes network
- [ ] `name:TestDevice` changes device name
- [ ] `fetch:config` fetches from server
- [ ] `reboot` restarts device

### WiFi Connectivity
- [ ] ESP connects on first boot
- [ ] Auto-connects after reboot
- [ ] Tries networks in order
- [ ] Only tries enabled networks
- [ ] Shows correct IP and RSSI
- [ ] Falls through to next network if one fails

### Server Communication
- [ ] Sends data to primary address
- [ ] Falls back to secondary address if needed
- [ ] Sends all sensor data (DHT, AHT, BH, voltage)
- [ ] Includes device name in payload
- [ ] Stores upload in `upload/` directory
- [ ] Visible in `/view` dashboard

### Configuration Management
- [ ] Config fetched on startup
- [ ] Config fetched every 5 minutes
- [ ] Manual fetch works via `fetch:config`
- [ ] Web settings update config
- [ ] Upload interval changes take effect
- [ ] WiFi networks update without recompile
- [ ] Server addresses update dynamically

### Auto-Light Logic
- [ ] `enableAutoLight` works when true
- [ ] Responds to `lightThreshold` value
- [ ] Pin12 controls based on lux
- [ ] Server-side logic executes

---

## 🚨 Common Issues & Fixes

### Issue: Bluetooth device not found
**Solution:**
- Power cycle ESP (disconnect power 5 seconds)
- Check BluetoothSerial library installed
- Verify platformio.ini has BluetoothSerial in lib_deps
- Recompile and upload

### Issue: ESP connects but can't reach server
**Solution:**
- Check WiFi signal strength: `status` → check RSSI
- Verify internet connectivity
- Try `fetch:config` to check server
- Check `sendAddresses` in web settings

### Issue: Config not updating
**Solution:**
- Manually force update: `fetch:config`
- Check server is running
- Verify `/api/config` endpoint responds
- Check device can reach server IP/domain

### Issue: Serial monitor shows junk
**Solution:**
- Verify baud rate is 115200
- Check USB cable connection
- Try different USB port
- Recompile and upload fresh firmware

### Issue: WiFi auth fails
**Solution:**
- Double-check SSID spelling via `wifi:list`
- Verify password is exact (case-sensitive)
- Try: `wifi:remove:INDEX` then `wifi:add:SSID:NEWPASS`
- Reboot: `reboot`

---

## 📊 Performance Expectations

| Metric | Value |
|--------|-------|
| Startup time | ~10-15 seconds |
| WiFi connect | ~5-10 seconds (if signal good) |
| Config fetch | ~3-5 seconds |
| Data upload | ~1-2 seconds |
| Bluetooth response | <500ms |
| Config update interval | 5 minutes |
| Upload data interval | configurable (default 1s) |

---

## 🔐 Security Recommendations

1. **Change Bluetooth PIN** (optional)
   - Edit in setup(): `SerialBT.begin("ESP8266_BT", true, "1234")`

2. **Use HTTPS for config server**
   - Already doing: `https://api-esp-tnww.onrender.com`

3. **Limit WiFi networks stored**
   - Currently max 5, should be enough for most users

4. **Validate sendAddresses format**
   - Server validates format, but consider rate limiting

5. **Consider captive portal** (future enhancement)
   - For initial setup without pre-configured WiFi

---

## 📈 Monitoring & Logging

### Serial Monitor Output
```bash
platformio device monitor -b 115200 -p /dev/ttyUSB0
```

Shows:
- Boot messages
- WiFi connection attempts
- Config fetch status
- Data upload results
- Error messages

### Server Logs
```bash
# On server machine
tail -f /var/log/esp_server.log
```

Shows:
- Config requests
- Upload receives
- Storage operations
- Auto-light triggers

### Dashboard Monitoring
```
https://api-esp-tnww.onrender.com/view
```

Shows:
- Latest upload timestamp
- All sensor values
- Device metadata
- Historical data directory

---

## 🎯 Success Criteria

After deployment:
- ✓ ESP boots and connects to WiFi
- ✓ Bluetooth available immediately
- ✓ Can configure WiFi via Bluetooth without reupload
- ✓ Config syncs automatically every 5 minutes
- ✓ Data appears on web dashboard
- ✓ Can add/change servers via web UI
- ✓ Upload interval adjusts from server
- ✓ Multiple networks work
- ✓ Fallback to different server works
- ✓ No firmware changes needed for config updates

---

## 📞 Support Information

### Debug Tools Available
1. **Serial Monitor** - Full verbose logging
2. **Bluetooth** - Command interface
3. **Web Dashboard** - Data visualization
4. **Server Logs** - Receive events

### Getting Help
1. Check relevant `.md` file in project root
2. Review console output in Serial Monitor
3. Try commands individually via Bluetooth
4. Verify server is responding with config
5. Check device has power and WiFi signal

### Files to Share If Issues
- Serial Monitor output (full boot sequence)
- Result of `wifi:list` via Bluetooth
- Result of `status` via Bluetooth
- Error messages from web console

---

## 📅 Maintenance Schedule

**Weekly:**
- Check `/view` dashboard for regular data
- Monitor upload frequency in `upload/` dir
- Verify no errors in server logs

**Monthly:**
- Review device logs for anomalies
- Check WiFi signal strength
- Verify battery voltage if applicable

**Quarterly:**
- Test failover to backup server
- Verify all configured networks reachable
- Review and update server addresses

---

## 🎓 Learning Resources

Within this project:
- `QUICK_REFERENCE.md` - Command reference
- `BLUETOOTH_SETUP.md` - Setup guide
- `IMPLEMENTATION_SUMMARY.md` - Technical details
- `ESP_CHANGES.md` - Code changes overview

External:
- ArduinoJson documentation
- ESP8266 Community Wiki
- BluetoothSerial examples
- Express.js API reference

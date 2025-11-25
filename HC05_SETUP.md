# ESP8266 + HC-05 Bluetooth Module Setup

## Hardware Wiring

### HC-05 Module to ESP8266

| HC-05 Pin | ESP8266 Pin | Function |
|-----------|-------------|----------|
| VCC | 3.3V | Power (+3.3V) |
| GND | GND | Ground |
| TX | D7 (GPIO13) | Transmit → RX on ESP |
| RX | D8 (GPIO15) | Receive ← TX on ESP |

## Connections Diagram

```
┌─────────────────────────────────────────────┐
│             ESP8266 (NodeMCU)               │
├─────────────────────────────────────────────┤
│ D7 (GPIO13) ─────────────────┐              │
│                             │              │
│                        SoftwareSerial       │
│                             │              │
│ D8 (GPIO15) ─────────────────┘              │
│                                             │
│ 3V3 ───────────────────┐                    │
│ GND ───────────────────┼─────────┐          │
└───────────────────────────────┼──┼──────────┘
                                │  │
                    ┌───────────┘  └──┐
                    │                 │
              ┌─────────────────────────────┐
              │     HC-05 Bluetooth         │
              ├─────────────────────────────┤
              │ VCC                    RX   │◄─── to D8 (GPIO15)
              │ GND                    TX   │◄─── from D7 (GPIO13)
              │ EN                    GND   │
              │ STATE                 VCC   │
              └─────────────────────────────┘
                  (Bluetooth Module)
```

## HC-05 AT Commands (Before Use)

Connect HC-05 to FTDI/USB adapter and configure:

```
AT+NAME=ESP8266_BT      → Set device name
AT+PIN=0000             → Set PIN code
AT+UART=9600,0,0        → Set baud rate (9600)
AT+ROLE=1               → Slave mode
```

## Software Usage

### Bluetooth Commands Available

Connect from phone to "ESP8266_BT" and send:

```
help                      - Show all commands
status                    - WiFi status
wifi:list                 - List networks
wifi:add:SSID:PASSWORD   - Add WiFi
wifi:remove:N            - Remove network
name:DEVICE_NAME         - Set device name
fetch:config             - Get config from server
reboot                   - Restart ESP
```

## Testing Connection

### From Serial Monitor
```
1. Connect USB to ESP8266
2. Open Serial Monitor (115200 baud)
3. From phone: Connect to ESP8266_BT
4. Type: help
5. Should see command list on Serial Monitor
```

### From Phone
```
1. Install "Serial Bluetooth Terminal" app
2. Scan for ESP8266_BT
3. Connect
4. Send: status
5. Check response
```

## Troubleshooting

### HC-05 Not Found
- Check VCC/GND connections (should be 3.3V)
- Verify RX/TX are not swapped
- Check baud rate (default 9600)

### No Response from Commands
- Verify HC-05 is paired/connected
- Check Serial Monitor output on ESP
- Try sending "help" command

### Garbled Text
- Verify baud rate is 9600 on both sides
- Check phone app baud rate setting

### ESP8266 Restarting
- HC-05 might need more power
- Add capacitor (100µF) between VCC and GND on HC-05

## Power Consumption

HC-05 draws ~50mA when active
- Ensure USB power supply can handle
- Consider external 3.3V supply if issues

## Range

- Normal: ~10 meters
- Good signal: ~20 meters
- Line of sight: ~30-50 meters

## After Configuration

Once WiFi and servers are configured via Bluetooth:
1. Connection persists in ESP RAM
2. Auto-syncs from server every 5 minutes
3. Can reconnect via Bluetooth anytime
4. No need to keep phone connected constantly

## Alternative: Web Configuration

If you prefer web-based setup after initial WiFi:
1. Get ESP IP from Serial Monitor
2. Access: http://ESP_IP/settings
3. Configure everything from browser
4. No Bluetooth needed

## See Also

- QUICK_REFERENCE.md - Bluetooth commands list
- BLUETOOTH_SETUP.md - Detailed setup guide
- DEPLOYMENT_CHECKLIST.md - Full deployment steps

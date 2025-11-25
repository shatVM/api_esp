#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Adafruit_AHTX0.h>
#include <BH1750.h>
#include <Wire.h>
#include <EEPROM.h>

// Для WPA2-Enterprise
const char* WIFI_SSID = "FreeZSTU";
const char* WIFI_PASSWORD = "";

// --- Налаштування серверів ---
const char* PUBLIC_SERVER_HOST = "api-esp-tnww.onrender.com";
const int PUBLIC_SERVER_PORT = 443;
const char* LOCAL_SERVER_HOST = "192.168.1.115";
const int LOCAL_SERVER_PORT = 80;
const char* CONFIG_SERVER_HOST = "api-esp-tnww.onrender.com";
const int CONFIG_SERVER_PORT = 443;

unsigned long UPLOAD_INTERVAL = 1000; // 1 секунда (буде оновлюватися з сервера)
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 20000;

// --- Піни для керування ---
const int PIN_12 = 12; // D6 -> GPIO12
const int PIN_13 = 13; // D7 -> GPIO13
const int PIN_14 = 14; // D5 -> GPIO14

// --- Налаштування DHT сенсора ---
#define DHTPIN 2
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

// --- Налаштування I2C сенсорів ---
Adafruit_AHTX0 aht;
BH1750 lightMeter;

// --- Налаштування АЦП для вимірювання напруги ---
const int ADC_PIN = A0;
const float VOLTAGE_DIVIDER_RATIO = 5.0;

// --- Глобальні об'єкти ---
ESP8266WebServer espServer(80);
unsigned long lastUploadTime = 0;
unsigned long lastConfigFetchTime = 0;
const unsigned long CONFIG_FETCH_INTERVAL = 300000; // Оновлювати конфіг кожні 5 хвилин

// Конфігурація, завантажена з сервера
struct Config {
  bool enableAutoLight = false;      // If true, enables schedule-based control.
  bool enableLightThreshold = false;  // If true, enables light level threshold control.
  int lightThreshold = 40;
  int uploadIntervalSeconds = 30;
  String deviceName = "esp8266_12E";
  String sendAddresses[10]; // Max 10 addresses
  int sendAddressCount = 0;
  String wifiSSIDs[5]; // Max 5 networks
  String wifiPasswords[5];
  bool wifiEnabled[5];
  int wifiCount = 0;
  // Auto-light schedule (HH:MM strings)
  String autoLightStartTime = "07:00";
  String autoLightEndTime = "22:00";
  // Last-saved local time reported by server (ISO string)
  String lastSavedLocalTime = "";
  // Parsed base time components from lastSavedLocalTime
  int baseHour = -1;
  int baseMin = 0;
  int baseSec = 0;
  // millis() when config with base time was fetched
  unsigned long configFetchedAtMillis = 0;
} config;

// Forward declarations for functions used before their definitions
void fetchConfigFromServer();
void updatePinStatesFromServer();
void sendDataToServer();

// Time helpers
bool parseIsoTimeToHMS(const String &iso, int &h, int &m, int &s) {
  // Expect format like YYYY-MM-DDTHH:MM:SS(+|-)TZ or YYYY-MM-DDTHH:MM:SS
  if (iso.length() < 19) return false;
  String hs = iso.substring(11, 13);
  String ms = iso.substring(14, 16);
  String ss = iso.substring(17, 19);
  h = hs.toInt(); m = ms.toInt(); s = ss.toInt();
  return true;
}

int timeStringToMinutes(const String &hhmm) {
  if (hhmm.length() < 4) return -1;
  int colon = hhmm.indexOf(':');
  if (colon <= 0) return -1;
  int h = hhmm.substring(0, colon).toInt();
  int m = hhmm.substring(colon + 1).toInt();
  return (h * 60 + m) % (24 * 60);
}

int getCurrentMinutesFromConfigBase() {
  if (config.baseHour < 0) return -1;
  unsigned long elapsedSec = (millis() - config.configFetchedAtMillis) / 1000;
  long totalSec = (long)config.baseHour * 3600L + (long)config.baseMin * 60L + (long)config.baseSec + (long)elapsedSec;
  int minutes = (totalSec / 60) % (24 * 60);
  if (minutes < 0) minutes += 24 * 60;
  return minutes;
}

bool isWithinAutoLightSchedule() {
  int startM = timeStringToMinutes(config.autoLightStartTime);
  int endM = timeStringToMinutes(config.autoLightEndTime);
  int nowM = getCurrentMinutesFromConfigBase();
  if (startM < 0 || endM < 0) return true; // no schedule -> always allowed
  if (nowM < 0) return true; // no base time -> allow by default
  if (startM <= endM) {
    return (nowM >= startM && nowM < endM);
  } else {
    // Overnight window (e.g., 22:00 -> 06:00)
    return (nowM >= startM || nowM < endM);
  }
}

// Bluetooth removed: use Serial monitor or web UI for configuration

// --- Функція завантаження конфігурації з сервера ---
void fetchConfigFromServer() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Not connected to Wi-Fi, cannot fetch config");
    return;
  }

  HTTPClient http;
  WiFiClientSecure clientSecure;
  clientSecure.setInsecure();
  
  String url = "https://" + String(CONFIG_SERVER_HOST) + "/api/config";
  Serial.print("Fetching config from: ");
  Serial.println(url);

  if (!http.begin(clientSecure, url)) {
    Serial.println("HTTP begin() failed");
    return;
  }

  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    Serial.printf("Failed to fetch config, HTTP code: %d\n", httpCode);
    http.end();
    return;
  }

  String payload = http.getString();
  http.end();

  const size_t capacity = JSON_OBJECT_SIZE(20) + 1024;
  DynamicJsonDocument doc(capacity);
  DeserializationError error = deserializeJson(doc, payload);
  
  if (error) {
    Serial.print("deserializeJson() failed: ");
    Serial.println(error.c_str());
    return;
  }

  // Parse auto-light settings
  if (doc.containsKey("enableAutoLight")) {
    config.enableAutoLight = doc["enableAutoLight"].as<bool>();
  }
  if (doc.containsKey("lightThreshold")) {
    config.lightThreshold = doc["lightThreshold"].as<int>();
  }
  if (doc.containsKey("uploadIntervalSeconds")) {
    UPLOAD_INTERVAL = doc["uploadIntervalSeconds"].as<int>() * 1000;
  }
  if (doc.containsKey("deviceName")) {
    config.deviceName = doc["deviceName"].as<String>();
  }

  // Parse auto-light schedule times
  if (doc.containsKey("autoLightStartTime") && doc["autoLightStartTime"].is<const char*>()) {
    config.autoLightStartTime = doc["autoLightStartTime"].as<String>();
  }
  if (doc.containsKey("autoLightEndTime") && doc["autoLightEndTime"].is<const char*>()) {
    config.autoLightEndTime = doc["autoLightEndTime"].as<String>();
  }
  
  // Parse enableLightThreshold (if true: use lux only, ignore schedule)
  if (doc.containsKey("enableLightThreshold")) {
    config.enableLightThreshold = doc["enableLightThreshold"].as<bool>();
  }

  // Parse server-saved local time (ISO) and record base components
  if (doc.containsKey("lastSavedLocalTime") && doc["lastSavedLocalTime"].is<const char*>()) {
    config.lastSavedLocalTime = doc["lastSavedLocalTime"].as<String>();
    int h, m, s;
    if (parseIsoTimeToHMS(config.lastSavedLocalTime, h, m, s)) {
      config.baseHour = h; config.baseMin = m; config.baseSec = s;
      config.configFetchedAtMillis = millis();
      Serial.printf("Parsed base local time from server: %02d:%02d:%02d\n", h, m, s);
    } else {
      config.baseHour = -1;
    }
  }

  // Parse WiFi networks
  if (doc.containsKey("wifi") && doc["wifi"].is<JsonArray>()) {
    JsonArray wifiArray = doc["wifi"].as<JsonArray>();
    config.wifiCount = min(5, (int)wifiArray.size());
    for (int i = 0; i < config.wifiCount; i++) {
      config.wifiSSIDs[i] = wifiArray[i]["ssid"].as<String>();
      config.wifiPasswords[i] = wifiArray[i]["password"].as<String>();
      config.wifiEnabled[i] = wifiArray[i]["enabled"].as<bool>();
    }
  }

  // Parse send addresses
  if (doc.containsKey("sendAddresses") && doc["sendAddresses"].is<JsonArray>()) {
    JsonArray addrArray = doc["sendAddresses"].as<JsonArray>();
    config.sendAddressCount = min(10, (int)addrArray.size());
    for (int i = 0; i < config.sendAddressCount; i++) {
      config.sendAddresses[i] = addrArray[i].as<String>();
    }
  }

  Serial.println("Config fetched successfully!");
  Serial.printf("Device: %s, Interval: %lu ms, AutoLight: %d\n", 
    config.deviceName.c_str(), UPLOAD_INTERVAL, config.enableAutoLight);
}

// --- Вспоміжні ---
void handleNotFound() {
  espServer.send(404, "text/plain", "Not Found");
}

// --- Функція обробки команд ---
void handleControl() {
  int pin = -1;
  int state = -1;

  if (espServer.hasArg("pin") && espServer.hasArg("state")) {
    pin = espServer.arg("pin").toInt();
    state = espServer.arg("state").toInt();

    // Логіка для пінів керування
    if ((pin == PIN_12 || pin == PIN_13 || pin == PIN_14) && (state == 0 || state == 1)) {
      Serial.printf("Control Request: Set pin %d to state %d\n", pin, state);
      pinMode(pin, OUTPUT);
      digitalWrite(pin, state ? HIGH : LOW);
      espServer.send(200, "text/plain", "OK");
      return;
    }
  }

  Serial.println("Bad control request");
  espServer.send(400, "text/plain", "Bad Request: 'pin' and 'state' parameters are required and must be valid.");
}

// --- Функція отримання публічної IP-адреси ---
String getPublicIP() {
  HTTPClient http;
  WiFiClient client;
  String publicIp = "";
  if (http.begin(client, "http://api.ipify.org")) {
    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
      publicIp = http.getString();
      publicIp.trim();
      Serial.printf("Public IP address found: %s\n", publicIp.c_str());
    } else {
      Serial.printf("Failed to get public IP, HTTP code: %d, error: %s\n", httpCode, http.errorToString(httpCode).c_str());
    }
    http.end();
  } else {
    Serial.println("Failed to begin HTTP client for public IP check.");
  }
  return publicIp;
}

// --- Функція відправки даних на сервер ---
void sendDataToServer() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Not connected to Wi-Fi, skipping upload.");
    return;
  }

  // Refresh configuration from server before each upload
  Serial.println("Refreshing config from server before upload...");
  fetchConfigFromServer();

  // Log current config to Serial for debugging
  Serial.println(F("=== Current Config ==="));
  Serial.printf("deviceName: %s\n", config.deviceName.c_str());
  Serial.printf("uploadInterval_ms: %lu\n", UPLOAD_INTERVAL);
  Serial.printf("enableAutoLight: %d\n", config.enableAutoLight ? 1 : 0);
  Serial.printf("lightThreshold: %d\n", config.lightThreshold);
  Serial.printf("sendAddressCount: %d\n", config.sendAddressCount);
  for (int i = 0; i < config.sendAddressCount; i++) {
    Serial.printf("  addr[%d]: %s\n", i, config.sendAddresses[i].c_str());
  }
  Serial.printf("wifiCount: %d\n", config.wifiCount);
  for (int i = 0; i < config.wifiCount; i++) {
    Serial.printf("  wifi[%d]: %s (%s)\n", i, config.wifiSSIDs[i].c_str(), config.wifiEnabled[i] ? "EN" : "DIS");
  }
  Serial.println(F("======================="));

  String publicIp = getPublicIP();

  // --- Підготовка JSON-даних ---
  const size_t capacity = 1024;
  DynamicJsonDocument jsonDoc(capacity);

  jsonDoc["ip"] = WiFi.localIP().toString();
  jsonDoc["uptime_ms"] = millis();
  jsonDoc["public_ip"] = publicIp;
  jsonDoc["gateway_ip"] = WiFi.gatewayIP().toString();
  jsonDoc["rssi_dbm"] = WiFi.RSSI();
  jsonDoc["deviceName"] = config.deviceName;
  
  // --- Дані з сенсорів ---
  // DHT11
  float humidity_dht = dht.readHumidity();
  float temperature_dht = dht.readTemperature();
  if (!isnan(humidity_dht)) jsonDoc["humidity_dht_pct"] = humidity_dht;
  if (!isnan(temperature_dht)) jsonDoc["temperature_dht_c"] = temperature_dht;

  // AHTx0
  sensors_event_t humidity_aht, temp_aht;
  if (aht.getEvent(&humidity_aht, &temp_aht)) {
    jsonDoc["temperature_aht_c"] = temp_aht.temperature;
    jsonDoc["humidity_aht_pct"] = humidity_aht.relative_humidity;
  }

  // BH1750
  float lux = lightMeter.readLightLevel();
  if (lux >= 0) {
      jsonDoc["lux"] = lux;
  } else {
      Serial.println(F("Failed to read from BH1750 sensor!"));
  }

  // --- Device-side auto-light enforcement for PIN_12 ---
  // New logic based on user request:
  // - "enableAutoLight" checkbox controls schedule.
  // - "enableLightThreshold" checkbox controls light level threshold.
  // - If both are checked, they work together (AND logic).
  bool shouldTurnOn = false;
  bool autoModeActive = config.enableAutoLight || config.enableLightThreshold;

  if (autoModeActive) {
    bool isDark = (lux >= 0) ? (lux < config.lightThreshold) : false;
    bool withinSchedule = isWithinAutoLightSchedule();

    if (config.enableAutoLight && !config.enableLightThreshold) {
      // Mode 1: Schedule only
      shouldTurnOn = withinSchedule;
      Serial.printf("Auto-light [SCHEDULE-ONLY mode]: inSchedule=%d\n", withinSchedule ? 1 : 0);
    } else if (!config.enableAutoLight && config.enableLightThreshold) {
      // Mode 2: Threshold only
      shouldTurnOn = isDark;
      Serial.printf("Auto-light [THRESHOLD-ONLY mode]: isDark=%d\n", isDark ? 1 : 0);
    } else if (config.enableAutoLight && config.enableLightThreshold) {
      // Mode 3: Schedule AND Threshold
      shouldTurnOn = withinSchedule && isDark;
      Serial.printf("Auto-light [SCHEDULE + LUX mode]: inSchedule=%d, isDark=%d\n",
                    withinSchedule ? 1 : 0, isDark ? 1 : 0);
    }
  }

  // Apply the final decision to the pin.
  // If no auto mode was active, shouldTurnOn remains false, turning the pin OFF.
  if (shouldTurnOn) {
    digitalWrite(PIN_12, HIGH);
    Serial.println("→ PIN_12 ON (auto)");
  } else {
    digitalWrite(PIN_12, LOW);
    if (autoModeActive) {
      Serial.println("→ PIN_12 OFF (auto)");
    }
  }

  // --- Деталі про пристрій ---
  jsonDoc["macAddress"] = WiFi.macAddress();
  jsonDoc["cpuFreqMHz"] = ESP.getCpuFreqMHz();
  jsonDoc["flashSizeMB"] = ESP.getFlashChipSize() / (1024.0 * 1024.0);
  jsonDoc["sdkVersion"] = ESP.getSdkVersion();
  jsonDoc["ssid"] = WiFi.SSID();
  jsonDoc["channel"] = WiFi.channel();
  jsonDoc["chipModel"] = "ESP8266";

  // --- Напруга батареї ---
  const int NUM_SAMPLES = 10;
  long adcTotal = 0;
  for (int i = 0; i < NUM_SAMPLES; i++) {
    adcTotal += analogRead(ADC_PIN);
    delay(2);
  }
  int adcValue = adcTotal / NUM_SAMPLES;
  float batteryVoltage = adcValue / 1023.0 * VOLTAGE_DIVIDER_RATIO;
  jsonDoc["battery_v"] = batteryVoltage;

  String jsonString;
  serializeJson(jsonDoc, jsonString);

  // --- Лямбда-функція для POST-запиту ---
  auto performPost = [&](WiFiClient& client, const String& host, int port, const String& path, bool isHttps) -> bool {
    HTTPClient http;
    String serverUrl = (isHttps ? "https" : "http") + String("://") + host + ":" + String(port) + path;
    Serial.printf("Attempting to send data to: %s\n", serverUrl.c_str());
    Serial.println(jsonString);

    if (!http.begin(client, serverUrl)) {
      Serial.println("HTTP begin() failed");
      return false;
    }
    http.addHeader("Content-Type", "application/json");
    int httpCode = http.POST(jsonString);
    String payload = http.getString();
    Serial.printf("HTTP Response code: %d\n", httpCode);
    Serial.println("Response: " + payload);
    http.end();
    return (httpCode >= 200 && httpCode < 300);
  };

  // --- Спроба відправки на налаштовані адреси ---
  bool success = false;
  for (int i = 0; i < config.sendAddressCount; i++) {
    String url = config.sendAddresses[i];
    if (url.length() == 0) continue;
    
    Serial.printf("Trying send address %d: %s\n", i, url.c_str());
    
    // Parse URL to get host, port, and path
    bool isHttps = url.startsWith("https");
    int protoEnd = url.indexOf("://") + 3;
    int hostEnd = url.indexOf('/', protoEnd);
    if (hostEnd == -1) hostEnd = url.length();
    
    String hostPart = url.substring(protoEnd, hostEnd);
    String path = hostEnd < url.length() ? url.substring(hostEnd) : "/upload";
    
    int portPos = hostPart.indexOf(':');
    String host = portPos > 0 ? hostPart.substring(0, portPos) : hostPart;
    int port = portPos > 0 ? hostPart.substring(portPos + 1).toInt() : (isHttps ? 443 : 80);
    
    if (isHttps) {
      WiFiClientSecure clientSecure;
      clientSecure.setInsecure();
      success = performPost(clientSecure, host, port, path, true);
    } else {
      WiFiClient client;
      success = performPost(client, host, port, path, false);
    }
    
    if (success) break;
  }

  if (success) Serial.println("Data sent successfully.");
  else Serial.println("Failed to send data to all configured servers.");
  Serial.println("-------------------- ");
}

// --- Функція оновлення стану пінів з сервера ---
void updatePinStatesFromServer() {
  if (WiFi.status() != WL_CONNECTED) return;

  Serial.println(F("--- Starting pin state update ---"));
  auto performPinStateGet = [&](const char* host, int port, bool isHttps) -> bool {
    HTTPClient http;
    String url = (isHttps ? "https" : "http") + String("://") + host + ":" + String(port) + "/pinstate";
    Serial.print(F("Requesting pin states from: ")); Serial.println(url);

    bool beginSuccess = false;
    if (isHttps) {
      WiFiClientSecure clientSecure;
      clientSecure.setInsecure();
      beginSuccess = http.begin(clientSecure, url);
    } else {
      WiFiClient client;
      beginSuccess = http.begin(client, url);
    }
    if (!beginSuccess) { Serial.println(F("... HTTP begin failed.")); return false; }

    int httpCode = http.GET();
    if (httpCode != HTTP_CODE_OK) {
      Serial.printf("... Failed, HTTP code: %d\n", httpCode);
      http.end();
      return false;
    }

    String payload = http.getString();
    http.end();
    Serial.print(F("... Received pin states: ")); Serial.println(payload);

    const size_t capacity = JSON_OBJECT_SIZE(3) + 64; // 3 піни
    DynamicJsonDocument doc(capacity);
    DeserializationError error = deserializeJson(doc, payload);
    if (error) { Serial.print(F("... deserializeJson() failed: ")); Serial.println(error.c_str()); return false; }

    // Застосовуємо стан нових пінів
    if (doc.containsKey("pin12")) digitalWrite(PIN_12, doc["pin12"].as<int>());
    if (doc.containsKey("pin13")) digitalWrite(PIN_13, doc["pin13"].as<int>());
    if (doc.containsKey("pin14")) digitalWrite(PIN_14, doc["pin14"].as<int>());
    
    return true;
  };

  bool success = performPinStateGet(PUBLIC_SERVER_HOST, PUBLIC_SERVER_PORT, true);
  if (!success) {
    Serial.println(F("Public server failed for pin states. Falling back to local..."));
    success = performPinStateGet(LOCAL_SERVER_HOST, LOCAL_SERVER_PORT, false);
  }

  if (success) Serial.println(F("Pin states updated successfully."));
  else Serial.println(F("Failed to update pin states from any server."));
  Serial.println(F("----------------------------------------"));
}

// --- SETUP ---
void setup() {
  Serial.begin(115200);
  Serial.println("\nESP8266 Starting...");

  // Bluetooth removed: configure via Serial monitor or web UI
  
  // Set default config
  config.wifiCount = 2;
  config.wifiSSIDs[0] = "FreeZSTU";
  config.wifiPasswords[0] = "";
  config.wifiEnabled[0] = true;
  config.wifiSSIDs[1] = "POCOFree";
  config.wifiPasswords[1] = "";
  config.wifiEnabled[1] = false;
  config.sendAddressCount = 1;
  config.sendAddresses[0] = "https://api-esp-tnww.onrender.com";
  config.deviceName = "esp8266_12E";

  // Ініціалізація I2C
  Wire.begin(4, 5); // SDA: GPIO4 (D2), SCL: GPIO5 (D1)

  // Ініціалізація пінів керування
  pinMode(PIN_12, OUTPUT);
  pinMode(PIN_13, OUTPUT);
  pinMode(PIN_14, OUTPUT);
  digitalWrite(PIN_12, LOW);
  digitalWrite(PIN_13, LOW);
  digitalWrite(PIN_14, LOW);

  // Ініціалізація DHT сенсора
  dht.begin();

  // Ініціалізація AHTx0
  if (!aht.begin()) {
    Serial.println("Could not find AHTx0? Check wiring");
  } else {
    Serial.println("AHTx0 found");
  }

  // Ініціалізація BH1750
  if (!lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
    Serial.println(F("Could not find BH1750? Check wiring"));
  } else {
    Serial.println(F("BH1750 found"));
  }

  // Підключення до Wi-Fi (спроба першої включеної мережі)
  bool connected = false;
  for (int i = 0; i < config.wifiCount; i++) {
    if (!config.wifiEnabled[i]) continue;
    
    Serial.print("Attempting to connect to: ");
    Serial.println(config.wifiSSIDs[i]);
    
    WiFi.mode(WIFI_STA);
    WiFi.begin(config.wifiSSIDs[i].c_str(), config.wifiPasswords[i].c_str());
    
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - start) < WIFI_CONNECT_TIMEOUT_MS) {
      delay(250);
      Serial.print(".");
    }
    
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\nConnected!");
      Serial.print("IP Address: ");
      Serial.println(WiFi.localIP());
      connected = true;
      
      // Fetch config from server
      delay(1000);
      fetchConfigFromServer();
      updatePinStatesFromServer();
      break;
    }
  }
  
  if (!connected) {
    Serial.println("\nWi-Fi connect timed out. Use Serial monitor or web UI to configure settings.");
  }

  // Маршрути сервера
  espServer.on("/control", HTTP_GET, handleControl);
  espServer.onNotFound(handleNotFound);
  espServer.begin();
  Serial.println("ESP Web Server started. Control endpoint is at /control");
}

// --- LOOP ---
void loop() {
  espServer.handleClient();

  // Bluetooth removed — no Bluetooth command handling

  // Periodic data upload
  if (millis() - lastUploadTime >= UPLOAD_INTERVAL) {
    lastUploadTime = millis();
    sendDataToServer();
    updatePinStatesFromServer();
  }

  // Periodic config fetch from server (every 5 minutes)
  if (WiFi.isConnected() && millis() - lastConfigFetchTime >= CONFIG_FETCH_INTERVAL) {
    lastConfigFetchTime = millis();
    Serial.println("Periodic config fetch...");
    fetchConfigFromServer();
  }
}
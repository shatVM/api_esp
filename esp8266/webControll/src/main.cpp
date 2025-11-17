#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Adafruit_AHTX0.h>
#include <BH1750.h> // Додано для BH1750
#include <Wire.h>    // Додано для I2C

// Для WPA2-Enterprise
const char* WIFI_SSID = "FreeZSTU";      // <-- ВАШ SSID
const char* WIFI_PASSWORD = "";      // <-- ВАШ ПАРОЛЬ (краще не хардкодити)

// --- Налаштування серверів ---
const char* PUBLIC_SERVER_HOST = "api-esp-tnww.onrender.com";
const int PUBLIC_SERVER_PORT = 443;
const char* LOCAL_SERVER_HOST = "192.168.1.115";
const int LOCAL_SERVER_PORT = 80;

const unsigned long UPLOAD_INTERVAL = 1000; // 1 секунда
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 20000; // таймаут підключення Wi-Fi

// --- Піни для керування ---
const int PIN_12 = 12; // D6 -> GPIO12
const int PIN_13 = 13; // D7 -> GPIO13
const int PIN_14 = 14; // D5 -> GPIO14

// --- Налаштування DHT сенсора ---
#define DHTPIN 2     // Пін, до якого підключено DHT11 (D4 на NodeMCU)
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

  String publicIp = getPublicIP();

  // --- Підготовка JSON-даних ---
  const size_t capacity = 1024;
  DynamicJsonDocument jsonDoc(capacity);

  jsonDoc["ip"] = WiFi.localIP().toString();
  jsonDoc["uptime_ms"] = millis();
  jsonDoc["public_ip"] = publicIp;
  jsonDoc["gateway_ip"] = WiFi.gatewayIP().toString();
  jsonDoc["rssi_dbm"] = WiFi.RSSI();
  jsonDoc["deviceName"] = "esp8266_12E";
  
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

  // --- Спроба відправки ---
  bool success = false;
  {
    WiFiClientSecure clientSecure;
    clientSecure.setInsecure();
    success = performPost(clientSecure, PUBLIC_SERVER_HOST, PUBLIC_SERVER_PORT, "/upload", true);
  }
  if (!success) {
    Serial.println("\nFailed to send to public server. Falling back to local server...");
    WiFiClient client;
    success = performPost(client, LOCAL_SERVER_HOST, LOCAL_SERVER_PORT, "/upload", false);
  }

  if (success) Serial.println("Data sent successfully.");
  else Serial.println("Failed to send data to both servers.");
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

  // Підключення до Wi-Fi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nConnected!");
    Serial.print("IP Address: "); Serial.println(WiFi.localIP());
    updatePinStatesFromServer();
  } else {
    Serial.println("\nWi-Fi connect timed out.");
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

  if (millis() - lastUploadTime >= UPLOAD_INTERVAL) {
    lastUploadTime = millis();
    sendDataToServer();
    updatePinStatesFromServer(); // Оновлюємо стан пінів після відправки даних
  }
}
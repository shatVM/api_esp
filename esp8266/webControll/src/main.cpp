#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <DHT.h>

// Для WPA2-Enterprise
const char* WIFI_SSID = "FreeZSTU";      // <-- ВАШ SSID
const char* WIFI_PASSWORD = "";      // <-- ВАШ ПАРОЛЬ (краще не хардкодити)

// --- Налаштування серверів ---
// Пріоритетний публічний сервер (HTTPS)
// const char* PUBLIC_SERVER_HOST = "api-esp-tnww.onrender.com";
const char* PUBLIC_SERVER_HOST = "api-esp-tnww.onrender.com";

const int PUBLIC_SERVER_PORT = 443;

// Резервний локальний сервер (HTTP)
const char* LOCAL_SERVER_HOST = "192.168.1.115";
const int LOCAL_SERVER_PORT = 80;

const unsigned long UPLOAD_INTERVAL = 1000; // 30 секунд
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 20000; // таймаут підключення Wi-Fi

// Піни (GPIO numbers)
const int PIN_4 = 4;   // D2 -> GPIO4
const int PIN_5 = 5;   // D1 -> GPIO5
const int PIN_6 = 12; // D6 -> GPIO12
const int PIN_7 = 13; // D7 -> GPIO13

// --- Налаштування DHT сенсора ---
#define DHTPIN 2     // Пін, до якого підключено DHT11 (D4 на NodeMCU)
#define DHTTYPE DHT11  // Тип сенсора

DHT dht(DHTPIN, DHTTYPE);

// --- Налаштування АЦП для вимірювання напруги ---
const int ADC_PIN = A0;
// Коефіцієнт дільника напруги. Розрахунок: (R1 + R2) / R2.
// ESP8266 вимірює до 1.0V на піні A0. Дільник потрібен, щоб знизити напругу батареї.
// Наприклад, для R1=300kОм, R2=100kОм, коефіцієнт = (300+100)/100 = 4.0.
// Налаштуйте це значення відповідно до вашої схеми!
// Розрахунок для дільника 400кОм + 100кОм: (400 + 100) / 100 = 5.0
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

    // Спеціальна логіка для PIN_5: імітація натискання кнопки
    if (pin == PIN_5) {
      Serial.println("Control Request: Simulating button press on PIN_5");

      pinMode(PIN_5, OUTPUT);
      digitalWrite(PIN_5, HIGH); // "Натискаємо" кнопку
      delay(300);                // Тримаємо 300 мс
      digitalWrite(PIN_5, LOW);  // "Відпускаємо" кнопку

      espServer.send(200, "text/plain", "OK - Pulsed PIN_5");
      return;
    }

    // Стандартна логіка для інших пінів
    if ((pin == PIN_4 || pin == PIN_6 || pin == PIN_7) && (state == 0 || state == 1)) {
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

  // Використовуємо простий сервіс, який повертає лише IP
  if (http.begin(client, "http://api.ipify.org")) {
    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
      publicIp = http.getString();
      publicIp.trim(); // Видаляємо зайві пробіли або переноси рядків
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

  // 1. Отримуємо публічну IP-адресу
  String publicIp = getPublicIP();

  // 2. Підготовка JSON-даних
  
  // Читаємо дані з DHT11
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature(); // or dht.readTemperature(true) for Fahrenheit

  // Перевіряємо, чи вдалося зчитати дані
  if (isnan(humidity) || isnan(temperature)) {
    Serial.println(F("Failed to read from DHT sensor!"));
    // Можна не відправляти дані, якщо сенсор не працює, або відправити з null значеннями
    // Тут ми просто не додаємо ці поля в JSON
  }

  const size_t capacity = 1024;
  DynamicJsonDocument jsonDoc(capacity);

  jsonDoc["ip"] = WiFi.localIP().toString();
  jsonDoc["uptime_ms"] = millis();
  jsonDoc["public_ip"] = publicIp;
  jsonDoc["gateway_ip"] = WiFi.gatewayIP().toString();
  jsonDoc["rssi_dbm"] = WiFi.RSSI();
  jsonDoc["deviceName"] = "esp8266_12E";
  jsonDoc["lux"] = random(50, 300); // Залишаємо випадкове значення для освітленості

  // Додаємо нові деталі про пристрій
  jsonDoc["macAddress"] = WiFi.macAddress();
  jsonDoc["cpuFreqMHz"] = ESP.getCpuFreqMHz();
  jsonDoc["flashSizeMB"] = ESP.getFlashChipSize() / (1024.0 * 1024.0);
  jsonDoc["sdkVersion"] = ESP.getSdkVersion();
  jsonDoc["ssid"] = WiFi.SSID();
  jsonDoc["channel"] = WiFi.channel();
  jsonDoc["chipModel"] = "ESP8266";

  // Додаємо дані з DHT, якщо вони валідні
  if (!isnan(temperature)) {
    jsonDoc["temperature_dht_c"] = temperature;
  }
  if (!isnan(humidity)) {
    jsonDoc["humidity_dht_pct"] = humidity;
  }
  
  // Читаємо та розраховуємо реальну напругу батареї, усереднюючи результат
  const int NUM_SAMPLES = 10;
  long adcTotal = 0;
  for (int i = 0; i < NUM_SAMPLES; i++) {
    adcTotal += analogRead(ADC_PIN);
    delay(2); // Коротка пауза для стабілізації АЦП
  }
  int adcValue = adcTotal / NUM_SAMPLES;
  
  Serial.printf("Raw ADC Value (Averaged): %d\n", adcValue); // Виводимо усереднене значення

  // Перетворюємо значення АЦП (0-1023) у напругу, враховуючи дільник
  float batteryVoltage = adcValue / 1023.0 * VOLTAGE_DIVIDER_RATIO;
  Serial.printf("Calculated Battery Voltage: %.2fV\n", batteryVoltage); // Виводимо розраховану напругу
  jsonDoc["battery_v"] = batteryVoltage;

  String jsonString;
  serializeJson(jsonDoc, jsonString);

  // 3. Лямбда-функція для виконання POST-запиту
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

    // Вважаємо успішним тільки коди 2xx.
    // Якщо сервер поверне 503, 404 і т.д., це буде вважатися помилкою і спрацює резервний варіант.
    return (httpCode >= 200 && httpCode < 300);
  };

  // 4. Спроба відправки на публічний HTTPS сервер
  bool success = false;
  {
    WiFiClientSecure clientSecure;
    // УВАГА: setInsecure() вимикає перевірку SSL-сертифіката.
    // Це спрощує розробку, але є небезпечним для продакшену.
    clientSecure.setInsecure();
    
    success = performPost(clientSecure, PUBLIC_SERVER_HOST, PUBLIC_SERVER_PORT, "/upload", true);
  }

  // 5. Якщо не вдалося, спроба відправки на локальний HTTP сервер
  if (!success) {
    Serial.println("\nFailed to send to public server. Falling back to local server...");
    {
      WiFiClient client;
      success = performPost(client, LOCAL_SERVER_HOST, LOCAL_SERVER_PORT, "/upload", false);
    }
  }

  if (success) {
    Serial.println("Data sent successfully.");
  } else {
    Serial.println("Failed to send data to both public and local servers.");
  }
  Serial.println("-------------------- ");
}


// --- Функція оновлення стану пінів з сервера ---
void updatePinStatesFromServer() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("Cannot update pin states, not connected to Wi-Fi."));
    return;
  }

  Serial.println(F("--- Starting pin state update sequence ---"));

  // Лямбда для виконання GET-запиту
  auto performPinStateGet = [&](const char* host, int port, bool isHttps) -> bool {
    HTTPClient http;
    String url = (isHttps ? "https" : "http") + String("://") + host + ":" + String(port) + "/pinstate";
    
    Serial.print(F("Requesting pin states from: "));
    Serial.println(url);

    bool beginSuccess = false;
    if (isHttps) {
      WiFiClientSecure clientSecure;
      clientSecure.setInsecure();
      beginSuccess = http.begin(clientSecure, url);
    } else {
      WiFiClient client;
      beginSuccess = http.begin(client, url);
    }

    if (!beginSuccess) {
      Serial.println(F("... HTTP begin failed."));
      return false;
    }

    int httpCode = http.GET();

    if (httpCode != HTTP_CODE_OK) {
      Serial.printf("... Failed, HTTP code: %d\n", httpCode);
      http.end();
      return false;
    }

    String payload = http.getString();
    http.end(); // Закриваємо з'єднання якомога раніше

    Serial.print(F("... Received pin states: "));
    Serial.println(payload);

    const size_t capacity = JSON_OBJECT_SIZE(4) + 64;
    DynamicJsonDocument doc(capacity);
    DeserializationError error = deserializeJson(doc, payload);

    if (error) {
      Serial.print(F("... deserializeJson() failed: "));
      Serial.println(error.c_str());
      return false;
    }

    // Застосовуємо стан пінів
    if (doc.containsKey("pin4")) digitalWrite(PIN_4, doc["pin4"].as<int>());
    if (doc.containsKey("pin5")) digitalWrite(PIN_5, doc["pin5"].as<int>());
    if (doc.containsKey("pin6")) digitalWrite(PIN_6, doc["pin6"].as<int>());
    if (doc.containsKey("pin7")) digitalWrite(PIN_7, doc["pin7"].as<int>());
    
    return true; // Успіх
  };

  // Спочатку пробуємо публічний сервер
  bool success = performPinStateGet(PUBLIC_SERVER_HOST, PUBLIC_SERVER_PORT, true);

  // Якщо не вдалося, пробуємо локальний
  if (!success) {
    Serial.println(F("Public server failed for pin states. Falling back to local server..."));
    success = performPinStateGet(LOCAL_SERVER_HOST, LOCAL_SERVER_PORT, false);
  }

  if (success) {
    Serial.println(F("Pin states updated successfully."));
  } else {
    Serial.println(F("Failed to update pin states from any available server."));
  }
  Serial.println(F("----------------------------------------"));
}

// --- SETUP ---
void setup() {
  Serial.begin(115200);
  Serial.println("\nESP8266 Starting...");

  // Ініціалізація пінів
  pinMode(PIN_4, OUTPUT);
  pinMode(PIN_5, OUTPUT);
  pinMode(PIN_6, OUTPUT);
  pinMode(PIN_7, OUTPUT);
  digitalWrite(PIN_4, LOW);
  digitalWrite(PIN_5, LOW);
  digitalWrite(PIN_6, LOW);
  digitalWrite(PIN_7, LOW);

  // Ініціалізація random
  randomSeed(ESP.getCycleCount() ^ analogRead(A0));

  // Ініціалізація DHT сенсора
  dht.begin();

  // Підключення до Wi-Fi з таймаутом
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print(".");
  }
    if (WiFi.status() == WL_CONNECTED)
    {
      Serial.println("\nConnected!");
      Serial.print("IP Address: ");
      Serial.println(WiFi.localIP());
  
      // Отримуємо початковий стан пінів з сервера
      updatePinStatesFromServer();
    } else {
    Serial.println("\nWi-Fi connect timed out.");
    // Можна або перезавантажитись, або перейти в режим AP, або спробувати ще раз через деякий час.
    // Тут просто продовжуємо — upload буде пропускатися поки немає підключення.
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
  }
  // Періодично оновлюємо стани пінів з сервера через 5 секунд
  static unsigned long lastPinUpdateTime = 0;
  if (millis() - lastPinUpdateTime >= UPLOAD_INTERVAL) {
    lastPinUpdateTime = millis();
    updatePinStatesFromServer();
  }

}

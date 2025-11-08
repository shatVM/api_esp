/**
 * =====================================================================================
 * Код для ESP8266 (середовище PlatformIO або Arduino IDE)
 * =====================================================================================
 *
 * Цей скетч виконує наступні функції:
 * 1. Підключається до заданої мережі Wi-Fi.
 * 2. Кожні 30 секунд збирає дані (симульовані, але можна підключити реальні датчики)
 *    та відправляє їх у форматі JSON на Node.js сервер.
 * 3. Запускає на ESP8266 веб-сервер, який приймає GET-запити на ендпоінт `/control`
 *    для керування станом пінів (GPIO).
 *
 * Необхідні бібліотеки (для PlatformIO додайте в platformio.ini, для Arduino IDE встановіть через Library Manager):
 * - ArduinoJson (by Benoit Blanchon)
 *
 * Налаштування:
 * - Замініть `YOUR_WIFI_SSID`, `YOUR_WIFI_PASSWORD` та `YOUR_SERVER_IP` на ваші реальні дані.
 *
 * Ендпоінти:
 * - POST http://<SERVER_IP>/upload - для відправки даних з ESP.
 * - GET http://<ESP_IP>/control?pin=<PIN>&state=<0|1> - для керування пінами на ESP.
 *
 * =====================================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <ArduinoJson.h>

// --- 1. НАЛАШТУВАННЯ ---
const char* WIFI_SSID = "Kyivstar4G";         // <-- ВАШ SSID
const char* WIFI_PASSWORD = "34968141"; // <-- ВАШ ПАРОЛЬ
const char* SERVER_IP = "192.168.1.115";         // <-- IP-адреса комп'ютера з Node.js сервером
const int SERVER_PORT = 80;                       // Порт вашого сервера

// Інтервал відправки даних на сервер (в мілісекундах)
const unsigned long UPLOAD_INTERVAL = 30000; // 30 секунд

// Піни, якими можна керувати
const int PIN_5 = 5; // D1
const int PIN_6 = 12; // D6 (приклад, змініть на потрібний)
const int PIN_7 = 13; // D7 (приклад, змініть на потрібний)

// --- 2. ГЛОБАЛЬНІ ОБ'ЄКТИ ---
ESP8266WebServer espServer(80); // Веб-сервер на ESP для прийому команд
WiFiClient client;
HTTPClient http;

unsigned long lastUploadTime = 0;

// --- 3. ФУНКЦІЯ ОБРОБКИ КОМАНД КЕРУВАННЯ ---
void handleControl() {
  int pin = -1;
  int state = -1;

  // Перевіряємо, чи є параметри "pin" та "state" у запиті
  if (espServer.hasArg("pin") && espServer.hasArg("state")) {
    pin = espServer.arg("pin").toInt();
    state = espServer.arg("state").toInt();

    // Перевіряємо валідність параметрів
    if ((pin == PIN_5 || pin == PIN_6 || pin == PIN_7) && (state == 0 || state == 1)) {
      Serial.printf("Control Request: Set pin %d to state %d\n", pin, state);
      
      pinMode(pin, OUTPUT);
      digitalWrite(pin, state);
      
      espServer.send(200, "text/plain", "OK");
      return;
    }
  }

  // Якщо параметри невалідні або відсутні
  Serial.println("Bad control request");
  espServer.send(400, "text/plain", "Bad Request: 'pin' and 'state' parameters are required and must be valid.");
}

// --- 4. ФУНКЦІЯ ВІДПРАВКИ ДАНИХ НА СЕРВЕР ---
void sendDataToServer() {
  // Створюємо JSON-документ
  DynamicJsonDocument jsonDoc(1024);

  // Додаємо інформацію про пристрій та мережу
  jsonDoc["ip"] = WiFi.localIP().toString();
  jsonDoc["uptime_ms"] = millis();
  jsonDoc["rssi_dbm"] = WiFi.RSSI();
  jsonDoc["device"] = "esp8266_12E";

  // Симуляція даних з датчиків (замініть на реальні показники)
  // jsonDoc["lux"] = analogRead(A0); // Приклад з фоторезистором
  jsonDoc["lux"] = random(50, 300);
  jsonDoc["temperature_aht_c"] = 20.0 + (random(0, 100) / 100.0 * 5.0); // 20.0 - 25.0
  jsonDoc["humidity_aht_pct"] = 40.0 + (random(0, 100) / 100.0 * 20.0); // 40.0 - 60.0
  jsonDoc["battery_v"] = 3.3 + (random(0, 100) / 100.0 * 0.9); // 3.3 - 4.2

  // Серіалізуємо JSON в рядок
  String jsonString;
  serializeJson(jsonDoc, jsonString);

  // Формуємо URL для POST-запиту
  String serverUrl = "http://" + String(SERVER_IP) + ":" + String(SERVER_PORT) + "/upload";

  // Відправляємо HTTP POST запит
  http.begin(client, serverUrl);
  http.addHeader("Content-Type", "application/json");

  Serial.println("Sending data to server...");
  Serial.println(jsonString);

  int httpCode = http.POST(jsonString);

  if (httpCode > 0) {
    String payload = http.getString();
    Serial.printf("HTTP Response code: %d\n", httpCode);
    Serial.println("Response: " + payload);
  } else {
    Serial.printf("HTTP POST failed, error: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}

// --- 5. SETUP ---
void setup() {
  Serial.begin(115200);
  Serial.println("\nESP8266 Starting...");

  // Ініціалізація пінів як виходів
  pinMode(PIN_5, OUTPUT);
  pinMode(PIN_6, OUTPUT);
  pinMode(PIN_7, OUTPUT);
  // Встановлюємо початковий стан (вимкнено)
  digitalWrite(PIN_5, LOW);
  digitalWrite(PIN_6, LOW);
  digitalWrite(PIN_7, LOW);

  // Підключення до Wi-Fi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  // Налаштування маршрутів веб-сервера на ESP
  espServer.on("/control", HTTP_GET, handleControl);
  espServer.onNotFound( {
    espServer.send(404, "text/plain", "Not Found");
  });

  // Запуск веб-сервера на ESP
  espServer.begin();
  Serial.println("ESP Web Server started. Control endpoint is at /control");
}

// --- 6. LOOP ---
void loop() {
  // Обробка клієнтських запитів до веб-сервера ESP
  espServer.handleClient();

  // Перевірка, чи настав час відправляти дані на головний сервер
  if (millis() - lastUploadTime >= UPLOAD_INTERVAL) {
    lastUploadTime = millis();
    sendDataToServer();
  }
}
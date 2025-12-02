// ==== main.cpp for ESP8266 with MQTT Communication ====
// This code replaces the previous HTTP-based logic with MQTT.
//
// PLEASE MAKE SURE to add the following line to your platformio.ini
// under the [env:...] section's `lib_deps`:
//
// lib_deps =
//   ... other libraries
//   knolleary/PubSubClient
//

#include <ESP8266WiFi.h>
#include <WiFiManager.h>
#include <PubSubClient.h> // MQTT Library
#include <ESP8266HTTPClient.h> // Needed for initial config fetch
#include <WiFiClient.h>
#include <WiFiClientSecure.h> // Required for HTTPS
#include <memory> // Required for std::unique_ptr
#include <ArduinoJson.h>
#include <DHT.h>
#include <Adafruit_AHTX0.h>
#include <BH1750.h>
#include <Wire.h>

// --- Pin Definitions ---
const int PIN_12 = 12; // D6
const int PIN_13 = 13; // D7
const int PIN_14 = 14; // D5

// --- Sensor Setup ---
#define DHTPIN 2
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);
Adafruit_AHTX0 aht;
BH1750 lightMeter;
const int ADC_PIN = A0;
const float VOLTAGE_DIVIDER_RATIO = 5.0;

// --- Configuration Struct ---
// This struct holds all settings for the device.
// It's initially populated by an HTTP call, then updated via MQTT.
struct Config {
  // MQTT Settings
  bool mqttEnabled = false;
  String mqttBrokerUrl = "";
  int mqttPort = 1883;
  String mqttUsername = "";
  String mqttPassword = "";
  String mqttBaseTopic = "esp_device";

  // Device Settings
  int uploadIntervalSeconds = 30;
  String deviceName = "esp8266_device";
} config;


// --- Global Objects ---
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
unsigned long lastUploadTime = 0;
unsigned long lastMqttReconnectAttempt = 0;

// --- Forward Declarations ---
void mqttCallback(char* topic, byte* payload, unsigned int length);
void reconnectMqtt();
void fetchInitialConfig();

void setup() {
  Serial.begin(115200);
  Serial.println("\n[INFO] Booting device with MQTT support...");

  // --- Initialize Hardware ---
  Wire.begin(4, 5); // SDA: GPIO4 (D2), SCL: GPIO5 (D1)
  pinMode(PIN_12, OUTPUT);
  pinMode(PIN_13, OUTPUT);
  pinMode(PIN_14, OUTPUT);
  digitalWrite(PIN_12, LOW);
  digitalWrite(PIN_13, LOW);
  digitalWrite(PIN_14, LOW);

  dht.begin();
  if (!aht.begin()) Serial.println("[WARN] AHTx0 sensor not found!");
  if (!lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) Serial.println("[WARN] BH1750 sensor not found!");

  // --- WiFi Setup ---
  WiFiManager wifiManager;
  // wifiManager.resetSettings(); // Uncomment to clear saved WiFi credentials
  wifiManager.setConfigPortalTimeout(180);
  String apName = "ESP-Config-" + String(ESP.getChipId(), HEX);
  if (!wifiManager.autoConnect(apName.c_str())) {
    Serial.println("[FATAL] Failed to connect to WiFi. Rebooting...");
    delay(3000);
    ESP.restart();
  }
  Serial.println("[INFO] WiFi connected!");
  Serial.print("  IP Address: ");
  Serial.println(WiFi.localIP());

  // --- Initial Configuration ---
  // Fetch the full configuration via HTTP once on boot to get MQTT broker details.
  fetchInitialConfig();

  // --- MQTT Setup ---
  if (config.mqttEnabled) {
    String broker = config.mqttBrokerUrl;
    if (broker.startsWith("mqtt://")) {
        broker = broker.substring(7);
    }
    mqttClient.setServer(broker.c_str(), config.mqttPort);
    mqttClient.setCallback(mqttCallback);
    Serial.println("[INFO] MQTT client configured.");
  } else {
    Serial.println("[WARN] MQTT is disabled in the fetched configuration.");
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WARN] WiFi disconnected. Rebooting to reconnect...");
    delay(10000);
    ESP.restart();
  }

  if (!config.mqttEnabled) {
    delay(5000); // If MQTT is off, just wait.
    return;
  }

  if (!mqttClient.connected()) {
    reconnectMqtt();
  }
  mqttClient.loop();

  // Publish telemetry periodically
  unsigned long now = millis();
  if (mqttClient.connected() && (now - lastUploadTime >= (unsigned long)config.uploadIntervalSeconds * 1000)) {
    lastUploadTime = now;
    
    const size_t capacity = 1024;
    DynamicJsonDocument jsonDoc(capacity);

    jsonDoc["ip"] = WiFi.localIP().toString();
    jsonDoc["uptime_ms"] = millis();
    jsonDoc["rssi_dbm"] = WiFi.RSSI();
    jsonDoc["deviceName"] = config.deviceName;

    float humidity_dht = dht.readHumidity();
    if (!isnan(humidity_dht)) jsonDoc["humidity_dht_pct"] = humidity_dht;
    float temperature_dht = dht.readTemperature();
    if (!isnan(temperature_dht)) jsonDoc["temperature_dht_c"] = temperature_dht;

    sensors_event_t humidity_aht, temp_aht;
    if (aht.getEvent(&humidity_aht, &temp_aht)) {
      jsonDoc["temperature_aht_c"] = temp_aht.temperature;
      jsonDoc["humidity_aht_pct"] = humidity_aht.relative_humidity;
    }

    float lux = lightMeter.readLightLevel();
    if (lux >= 0) jsonDoc["lux"] = lux;

    long adcTotal = 0;
    for (int i = 0; i < 10; i++) { adcTotal += analogRead(ADC_PIN); delay(2); }
    jsonDoc["battery_v"] = (adcTotal / 10.0) / 1023.0 * VOLTAGE_DIVIDER_RATIO;
    
    String jsonString;
    serializeJson(jsonDoc, jsonString);
    String telemetryTopic = config.mqttBaseTopic + "/telemetry";
    
    Serial.printf("[MQTT] Publishing to %s\n", telemetryTopic.c_str());
    mqttClient.publish(telemetryTopic.c_str(), jsonString.c_str());
  }
}

/**
 * @brief Handles incoming MQTT messages.
 */
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String topicStr = String(topic);
  Serial.printf("[MQTT] Message arrived on topic: %s\n", topicStr.c_str());

  char message[length + 1];
  memcpy(message, payload, length);
  message[length] = '\0';
  
  const size_t capacity = 1024;
  DynamicJsonDocument doc(capacity);
  DeserializationError error = deserializeJson(doc, message);
  if (error) {
    Serial.printf("[ERROR] Failed to parse JSON payload: %s\n", error.c_str());
    return;
  }

  // --- Topic for Pin Control ---
  if (topicStr == config.mqttBaseTopic + "/control/pins") {
    int pin = doc["pin"];
    int state = doc["state"];
    Serial.printf("  [CONTROL] Setting pin %d to state %d\n", pin, state);
    pinMode(pin, OUTPUT);
    digitalWrite(pin, state);
  }
  
  // --- Topic for Configuration Updates ---
  else if (topicStr == config.mqttBaseTopic + "/control/config") {
    Serial.println("  [CONFIG] Received configuration update.");
    if (doc.containsKey("uploadIntervalSeconds")) {
      config.uploadIntervalSeconds = doc["uploadIntervalSeconds"];
      Serial.printf("    - uploadIntervalSeconds set to: %d\n", config.uploadIntervalSeconds);
    }
    if (doc.containsKey("deviceName")) {
      config.deviceName = doc["deviceName"].as<String>();
      Serial.printf("    - deviceName set to: %s\n", config.deviceName.c_str());
    }
  }
}

/**
 * @brief Connects/reconnects to the MQTT broker.
 */
void reconnectMqtt() {
  unsigned long now = millis();
  if (now - lastMqttReconnectAttempt < 5000) {
    return;
  }
  lastMqttReconnectAttempt = now;

  Serial.print("[MQTT] Attempting to connect to broker... ");
  String clientId = "ESP8266-" + String(ESP.getChipId(), HEX);
  
  if (mqttClient.connect(clientId.c_str(), config.mqttUsername.c_str(), config.mqttPassword.c_str())) {
    Serial.println("connected!");
    
    String pinControlTopic = config.mqttBaseTopic + "/control/pins";
    String configControlTopic = config.mqttBaseTopic + "/control/config";
    
    mqttClient.subscribe(pinControlTopic.c_str());
    mqttClient.subscribe(configControlTopic.c_str());
    
    Serial.printf("  Subscribed to: %s\n", pinControlTopic.c_str());
    Serial.printf("  Subscribed to: %s\n", configControlTopic.c_str());
    
  } else {
    Serial.print("failed, rc=");
    Serial.print(mqttClient.state());
    Serial.println(" try again in 5 seconds");
  }
}

#include <WiFiClientSecure.h> // Required for HTTPS

/**
 * @brief Fetches the initial device configuration via HTTP from the server.
 */
void fetchInitialConfig() {
  Serial.println("[HTTP] Fetching initial configuration from public server...");
  
  String configUrl = "https://api-esp-tnww.onrender.com/api/config"; 
  
  // Use WiFiClientSecure for HTTPS
  // BearSSL::WiFiClientSecure clientSecure; // More explicit for clarity
  std::unique_ptr<BearSSL::WiFiClientSecure> client(new BearSSL::WiFiClientSecure());

  // Allow insecure connections (don't validate certificate)
  client->setInsecure(); 
  
  HTTPClient http;
  
  Serial.printf("Connecting to %s\n", configUrl.c_str());
  if (http.begin(*client, configUrl)) {
    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
      String payload = http.getString();
      Serial.println("[HTTP] Config received successfully.");

      const size_t capacity = JSON_OBJECT_SIZE(20) + 1024;
      DynamicJsonDocument doc(capacity);
      DeserializationError error = deserializeJson(doc, payload);

      if (!error) {
        config.uploadIntervalSeconds = doc["uploadIntervalSeconds"] | 30;
        config.deviceName = doc["deviceName"] | "esp_default";

        if (doc.containsKey("mqtt")) {
            JsonObject mqttConfig = doc["mqtt"];
            config.mqttEnabled = mqttConfig["enabled"] | false;
            config.mqttBrokerUrl = mqttConfig["brokerUrl"].as<String>();
            config.mqttPort = mqttConfig["port"] | 1883;
            config.mqttUsername = mqttConfig["username"].as<String>();
            config.mqttPassword = mqttConfig["password"].as<String>();
            config.mqttBaseTopic = mqttConfig["baseTopic"].as<String>();
        }

        // --- DEBUG OVERRIDE ---
        // Forcing MQTT to be enabled because the remote configuration has it disabled.
        // This allows the device to proceed with MQTT operations.
        config.mqttEnabled = true;

        Serial.println("[INFO] Configuration parsed and applied.");
      } else {
        Serial.println("[ERROR] Failed to parse config JSON.");
      }
    } else {
      Serial.printf("[ERROR] HTTP GET failed, code: %d, Message: %s\n", httpCode, http.errorToString(httpCode).c_str());
    }
    http.end();
  } else {
    Serial.println("[ERROR] HTTP begin failed.");
  }
}

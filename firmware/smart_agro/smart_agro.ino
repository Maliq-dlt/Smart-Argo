#include <Arduino.h>
#include <algorithm>
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <DallasTemperature.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <OneWire.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WebServer.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <esp_partition.h>
#include <esp_sleep.h>
#include <esp_sntp.h>
#include <esp_system.h>
#include <sys/time.h>
#include <time.h>

#if __has_include("DeviceConfig.h")
#include "DeviceConfig.h"
#else
#include "DeviceConfig.example.h"
#endif
#include "Telemetry.h"

namespace {
constexpr uint8_t kMoisturePin = 34;
constexpr uint8_t kPhPin = 35;
constexpr uint8_t kTemperaturePin = 27;
constexpr uint8_t kBatteryPin = 32;  // ADC1, usable while Wi-Fi is on
constexpr uint8_t kSetupButtonPin = 0;  // BOOT button on the DevKit
constexpr uint8_t kRtcAddress = 0x68;
constexpr uint32_t kSetupPortalMs = 10 * 60 * 1000;
constexpr time_t kQuarterHour = 15 * 60;
constexpr time_t kWakeLeadSeconds = 60;  // the RTC slow clock drifts up to about 5% over a 14-minute deep sleep
constexpr time_t kBoundarySlackSeconds = 20;
constexpr size_t kEnergyCapacity = 24 * 60 * 60 / kQuarterHour;
constexpr uint8_t kInaConfig = 0x00, kInaShuntCal = 0x02, kInaEnergy = 0x09, kInaMaker = 0x3E, kInaPart = 0x3F;
constexpr uint32_t kIntervalSeconds = 30 * 60;
constexpr uint32_t kWifiTimeoutMs = 15000;
constexpr time_t kEarliestUtc = 1767225600;  // 2026-01-01 UTC
constexpr int64_t kLatestUtc = 4102444800LL;  // Before the DS3231 century bit changes
constexpr char kPendingKey[] = "pending";
constexpr size_t kQueueCapacity = 24 * 60 * 60 / kIntervalSeconds;
constexpr size_t kEnvelopesPerWake = 8;
constexpr size_t kEnvelopeLimit = 12288;
constexpr char kQueueTemp[] = "/queue.tmp";
constexpr char kRtcSyncedKey[] = "rtc_verified";

OneWire oneWire(kTemperaturePin);
DallasTemperature soilProbe(&oneWire);
Preferences outbox;
RTC_DATA_ATTR time_t lastNetworkSync = 0;
RTC_DATA_ATTR time_t lastClockUsed = 0;
// Energy evidence state. RTC memory survives deep sleep but not a power cut, like the INA228 counters on the 3.3 V rail.
RTC_DATA_ATTR char energyBoot[37] = "";
RTC_DATA_ATTR uint32_t energySequence = 0;
RTC_DATA_ATTR time_t energyMark = 0;  // quarter-hour of the last counter reading, 0 when there is none
RTC_DATA_ATTR uint64_t solarMarkRaw = 0;
RTC_DATA_ATTR uint64_t loadMarkRaw = 0;
RTC_DATA_ATTR time_t lastTelemetry = 0;

bool trustworthyEpoch(time_t value) {
  return value >= kEarliestUtc && static_cast<int64_t>(value) < kLatestUtc;
}

bool i2cRead(uint8_t address, uint8_t reg, uint8_t *data, size_t length) {
  Wire.beginTransmission(address);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0 || Wire.requestFrom(address, length) != length) {
    return false;
  }
  for (size_t i = 0; i < length; ++i) {
    data[i] = Wire.read();
  }
  return true;
}

bool i2cWrite(uint8_t address, uint8_t reg, const uint8_t *data, size_t length) {
  Wire.beginTransmission(address);
  Wire.write(reg);
  Wire.write(data, length);
  return Wire.endTransmission() == 0;
}

bool readRtc(uint8_t reg, uint8_t *data, size_t length) { return i2cRead(kRtcAddress, reg, data, length); }

bool writeRtc(uint8_t reg, const uint8_t *data, size_t length) { return i2cWrite(kRtcAddress, reg, data, length); }

int fromBcd(uint8_t value) {
  if ((value & 0x0F) > 9 || (value >> 4) > 9) return -1;
  return (value >> 4) * 10 + (value & 0x0F);
}

uint8_t toBcd(int value) {
  return ((value / 10) << 4) | (value % 10);
}

time_t readTrustedClock() {
  uint8_t status;
  uint8_t calendar[7];
  if (!outbox.getBool(kRtcSyncedKey) || !readRtc(0x0F, &status, 1) || (status & 0x80) ||
      !readRtc(0x00, calendar, sizeof(calendar)) || (calendar[2] & 0x40) ||
      (calendar[5] & 0x80)) {
    return 0;
  }

  const int second = fromBcd(calendar[0] & 0x7F);
  const int minute = fromBcd(calendar[1] & 0x7F);
  const int hour = fromBcd(calendar[2] & 0x3F);
  const int day = fromBcd(calendar[4] & 0x3F);
  const int month = fromBcd(calendar[5] & 0x1F);
  const int year = fromBcd(calendar[6]);
  if (second < 0 || second > 59 || minute < 0 || minute > 59 || hour < 0 || hour > 23 ||
      day < 1 || day > 31 || month < 1 || month > 12 || year < 0) return 0;

  tm date{};
  date.tm_year = year + 100;
  date.tm_mon = month - 1;
  date.tm_mday = day;
  date.tm_hour = hour;
  date.tm_min = minute;
  date.tm_sec = second;
  const time_t epoch = mktime(&date);
  if (date.tm_mday != day || date.tm_mon != month - 1 || !trustworthyEpoch(epoch)) return 0;
  return epoch;
}

bool saveNetworkClock(time_t epoch) {
  tm utc{};
  if (!trustworthyEpoch(epoch) || !gmtime_r(&epoch, &utc)) return false;
  uint8_t status;
  if (!readRtc(0x0F, &status, 1)) return false;
  uint8_t calendar[] = {toBcd(utc.tm_sec), toBcd(utc.tm_min), toBcd(utc.tm_hour),
                        toBcd(utc.tm_wday + 1), toBcd(utc.tm_mday), toBcd(utc.tm_mon + 1),
                        toBcd(utc.tm_year - 100)};
  if (!writeRtc(0x00, calendar, sizeof(calendar))) return false;
  status &= 0x7F;
  if (!writeRtc(0x0F, &status, 1)) return false;
  return outbox.getBool(kRtcSyncedKey) || outbox.putBool(kRtcSyncedKey, true) != 0;
}

bool clockReady(bool wifiConnected) {
  time_t rtc = readTrustedClock();
  if (rtc != 0 && rtc <= lastClockUsed) {
    Serial.println("RTC did not advance since the last wake. Waiting for SNTP.");
    rtc = 0;
  }
  if (rtc != 0) {
    timeval now = {rtc, 0};
    if (settimeofday(&now, nullptr) != 0) return false;
  }
  if (!wifiConnected) return rtc != 0;
  if (rtc != 0 && lastNetworkSync != 0 && rtc >= lastNetworkSync &&
      rtc - lastNetworkSync < 6 * 60 * 60) return true;

  // Wait for actual SNTP completion even if the RTC already seeded the system clock.
  configTime(0, 0, "time.cloudflare.com", "pool.ntp.org");
  const uint32_t started = millis();
  while (millis() - started < 10000) {
    if (sntp_get_sync_status() == SNTP_SYNC_STATUS_COMPLETED) {
      const time_t networkTime = time(nullptr);
      if (trustworthyEpoch(networkTime)) {
        lastNetworkSync = networkTime;
        if (!saveNetworkClock(networkTime)) Serial.println("RTC backup unavailable.");
        return true;
      }
    }
    delay(200);
  }
  return rtc != 0;
}

uint32_t medianMv(uint8_t pin) {
  uint32_t samples[9];
  for (uint32_t &sample : samples) {
    sample = analogReadMilliVolts(pin);
    delay(10);
  }
  for (size_t i = 1; i < 9; ++i) {
    for (size_t j = i; j > 0 && samples[j] < samples[j - 1]; --j) {
      const uint32_t t = samples[j];
      samples[j] = samples[j - 1];
      samples[j - 1] = t;
    }
  }
  return samples[4];
}

SensorReading readMoisture() {
  const uint32_t mv = medianMv(kMoisturePin);
  Serial.printf("Moisture ADC: %lu mV\n", static_cast<unsigned long>(mv));
  if (device::moistureWetMv <= 0 || device::moistureDryMv > 3000 ||
      device::moistureDryMv - device::moistureWetMv < 100) {
    return {"not_measured", 0, nullptr};
  }
  if (mv < 100 || mv >= 3000) return {"error", 0, "Moisture ADC outside usable range"};
  const double index = 100.0 * (device::moistureDryMv - static_cast<double>(mv)) /
                       (device::moistureDryMv - device::moistureWetMv);
  return {"ok", constrain(index, 0.0, 100.0), nullptr};
}

SensorReading readPh(const SensorReading &moisture) {
  const uint32_t mv = medianMv(kPhPin);
  Serial.printf("pH ADC: %lu mV\n", static_cast<unsigned long>(mv));
  const int low = device::phLowMv;
  const int high = device::phHighMv;
  // The probe needs moisture for a meaningful soil pH reading.
  if (low < 100 || low >= 3000 || high < 100 || high >= 3000 || abs(high - low) < 50 ||
      strcmp(moisture.status, "ok") != 0 || moisture.value <= 0) {
    return {"not_measured", 0, nullptr};
  }
  const double ph = 4.01 + (6.86 - 4.01) * (static_cast<double>(mv) - low) / (high - low);
  if (mv < 100 || mv >= 3000 || !isfinite(ph) || ph < 0 || ph > 14) {
    return {"error", 0, "pH ADC or calibrated result outside usable range"};
  }
  return {"ok", ph, nullptr};
}

SensorReading readTemperature() {
  soilProbe.begin();
  DeviceAddress probe;
  // The RAB has one soil sensor. More addresses would make probe identity ambiguous.
  if (!soilProbe.getAddress(probe, 0) || (probe[0] != 0x28) || soilProbe.getDeviceCount() != 1) {
    return {"error", 0, "Expected one DS18B20 probe"};
  }
  soilProbe.requestTemperatures();
  const float reading = soilProbe.getTempC(probe);
  if (!isfinite(reading) || reading < -20 || reading > 60) {
    return {"error", 0, "DS18B20 disconnected or outside range"};
  }
  return {"ok", reading, nullptr};
}

// RAB: two 47k resistors from the battery (BMS B+) to GPIO32 halve the cell voltage, so a full 4.2 V cell reads about
// 2.1 V at the pin and the divider draws about 45 uA. batteryDivider = 0 in DeviceConfig.h means it is not wired.
SensorReading readBattery() {
  if (!(device::batteryDivider >= 1.0f && device::batteryDivider <= 4.0f)) return {"not_measured", 0, nullptr};
  const uint32_t mv = medianMv(kBatteryPin);
  const double volts = mv * static_cast<double>(device::batteryDivider) / 1000.0;
  Serial.printf("Battery: %lu mV at the pin, %.2f V\n", static_cast<unsigned long>(mv), volts);
  if (volts < 2.5 || volts > 4.5) return {"error", 0, "Battery voltage outside 2.5 to 4.5 V; check the divider"};
  return {"ok", round(volts * 100) / 100, nullptr};
}

bool validUuid(const char *value) {
  if (strlen(value) != 36 || value[14] < '1' || value[14] > '8' || !strchr("89abAB", value[19])) return false;
  for (size_t i = 0; i < 36; ++i) {
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (value[i] != '-') return false;
    } else if (!strchr("0123456789abcdefABCDEF", value[i])) {
      return false;
    }
  }
  return true;
}

struct WifiCredentials {
  String ssid;
  String password;
};

// Wi-Fi saved through the setup network wins over the network compiled into DeviceConfig.h.
WifiCredentials storedWifi() {
  WifiCredentials wifi{device::wifiSsid, device::wifiPassword};
  Preferences saved;
  if (saved.begin("wifi", true)) {
    if (saved.isKey("ssid")) {
      wifi.ssid = saved.getString("ssid");
      wifi.password = saved.getString("pass");
    }
    saved.end();
  }
  return wifi;
}

String htmlEscape(const String &text) {
  String out;
  for (const char c : text) {
    if (c == '&') out += "&amp;";
    else if (c == '<') out += "&lt;";
    else if (c == '>') out += "&gt;";
    else if (c == '"') out += "&quot;";
    else out += c;
  }
  return out;
}

// After a power-on or EN reset (never on a timer wake), holding BOOT for 2 seconds opens the setup network.
bool setupRequested() {
  pinMode(kSetupButtonPin, INPUT_PULLUP);
  uint32_t heldSince = 0;
  for (const uint32_t start = millis(); millis() - start < 4000; delay(20)) {
    if (digitalRead(kSetupButtonPin) != LOW) heldSince = 0;
    else if (!heldSince) heldSince = millis();
    else if (millis() - heldSince >= 2000) return true;
  }
  return false;
}

// RAB "BLE/AP pairing": a WPA2 network SmartAgro-xxxx (the first characters of the device ID the app shows), keyed
// with the setup password on the device label, serves one form that stores the home Wi-Fi in NVS. It closes after
// 10 minutes; a saved network restarts the device so it reports at once.
// ponytail: credentials sit in plain NVS like the compiled ones; enable flash and NVS encryption for production units.
void runSetupPortal() {
  const size_t keyLength = strlen(device::setupPassword);
  if (keyLength < 8 || keyLength > 63) {
    Serial.println("Wi-Fi setup needs setupPassword (8-63 characters) in DeviceConfig.h.");
    return;
  }
  char name[16];
  snprintf(name, sizeof(name), "SmartAgro-%.4s", validUuid(device::deviceId) ? device::deviceId : "0000");
  WiFi.persistent(false);
  WiFi.mode(WIFI_AP_STA);
  String options;
  const int found = WiFi.scanNetworks();
  for (int i = 0; i < found && i < 20; ++i) options += "<option value=\"" + htmlEscape(WiFi.SSID(i)) + "\">";
  WiFi.scanDelete();
  if (!WiFi.softAP(name, device::setupPassword)) {
    Serial.println("Setup network could not start.");
    WiFi.mode(WIFI_OFF);
    return;
  }
  Serial.printf("Setup network %s open at http://192.168.4.1/ for 10 minutes.\n", name);
  DNSServer dns;
  dns.start(53, "*", WiFi.softAPIP());  // phones then open the form as a sign-in page
  WebServer server(80);
  bool saved = false;
  const String head =
      "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
      "<title>Smart Agro</title><style>body{font:17px system-ui,sans-serif;max-width:28rem;margin:2rem auto;"
      "padding:0 1rem;color:#18211b;background:#ecefe7}input,button{font:inherit;width:100%;box-sizing:border-box;"
      "padding:.75rem;margin:.25rem 0 1rem;border:1px solid #55615a;border-radius:.75rem}"
      "button{background:#2f5a3c;color:#fff;border:0}</style>";
  server.on("/", HTTP_GET, [&]() {
    server.send(200, "text/html; charset=utf-8",
                head + "<h1>Wi-Fi perangkat</h1><form method=post action=/save>"
                       "<label>Nama Wi-Fi<input name=ssid list=found maxlength=32 required autocomplete=off></label>"
                       "<datalist id=found>" + options + "</datalist>"
                       "<label>Kata sandi Wi-Fi<input name=pass type=password maxlength=63></label>"
                       "<button>Simpan dan sambungkan</button></form><p>Hanya Wi-Fi 2,4 GHz.</p>");
  });
  server.on("/save", HTTP_POST, [&]() {
    const String ssid = server.arg("ssid");
    const String pass = server.arg("pass");
    if (ssid.isEmpty() || ssid.length() > 32 || (!pass.isEmpty() && pass.length() < 8) || pass.length() > 63) {
      server.send(400, "text/html; charset=utf-8",
                  head + "<p>Nama Wi-Fi 1-32 karakter; kata sandi kosong atau 8-63 karakter.</p><a href=/>Ulangi</a>");
      return;
    }
    Preferences store;
    saved = store.begin("wifi", false) && store.putString("ssid", ssid) == ssid.length() &&
            store.putString("pass", pass) == pass.length();
    store.end();
    server.send(saved ? 200 : 500, "text/html; charset=utf-8",
                head + (saved ? "<h1>Tersimpan</h1><p>Perangkat memulai ulang dan mengirim bacaan pertama dalam satu menit.</p>"
                              : "<p>Penyimpanan gagal. Ulangi atau hubungi pemasok.</p>"));
  });
  server.onNotFound([&]() {
    server.sendHeader("Location", "http://192.168.4.1/", true);
    server.send(302, "text/plain", "");
  });
  server.begin();
  for (const uint32_t opened = millis(); !saved && millis() - opened < kSetupPortalMs; delay(2)) {
    dns.processNextRequest();
    server.handleClient();
  }
  for (const uint32_t done = millis(); saved && millis() - done < 1500; delay(2)) server.handleClient();
  server.stop();
  dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_OFF);
  if (saved) ESP.restart();
}

bool connectWifi(const WifiCredentials &wifi) {
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifi.ssid.c_str(), wifi.password.c_str());
  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < kWifiTimeoutMs) delay(200);
  return WiFi.status() == WL_CONNECTED;
}

void newBootId(char (&uuid)[37]) {
  uint8_t bytes[16];
  esp_fill_random(bytes, sizeof(bytes));
  bytes[6] = (bytes[6] & 0x0F) | 0x40;
  bytes[8] = (bytes[8] & 0x3F) | 0x80;
  snprintf(uuid, sizeof(uuid), "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
           bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
           bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]);
}

// The default board layout labels its filesystem "spiffs". Format only factory-erased flash.
bool mountQueue() {
  if (LittleFS.begin()) return true;
  const esp_partition_t *partition = esp_partition_find_first(
      ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_SPIFFS, "spiffs");
  if (!partition) return false;
  uint8_t block[256];
  for (size_t start = 0; start < partition->size; start += sizeof(block)) {
    const size_t length = std::min(sizeof(block), partition->size - start);
    if (esp_partition_read(partition, start, block, length) != ESP_OK) return false;
    for (size_t i = 0; i < length; ++i) if (block[i] != 0xFF) return false;
  }
  return LittleFS.begin(true);
}

// Queue entries are /q... (telemetry) and /e... (energy windows), numbered in creation order.
void queuePath(char prefix, uint32_t id, char (&path)[13]) {
  snprintf(path, sizeof(path), "/%c%010lu", prefix, static_cast<unsigned long>(id));
}

template <size_t N>
bool loadQueue(char prefix, uint32_t (&ids)[N], size_t &count) {
  File root = LittleFS.open("/");
  if (!root || !root.isDirectory()) return false;
  for (File file = root.openNextFile(); file; file = root.openNextFile()) {
    const char *name = file.name();
    if (strlen(name) != 11 || name[0] != prefix || strspn(name + 1, "0123456789") != 10) continue;
    const unsigned long long id = strtoull(name + 1, nullptr, 10);
    if (count == N || id == 0 || id > UINT32_MAX) return false;
    ids[count++] = static_cast<uint32_t>(id);
  }
  std::sort(ids, ids + count);
  return true;
}

// Match the ingest window for permanently stale samples. Retry transport and provisioning failures while useful.
bool usableEnvelope(const String &packet, const uint8_t *seed = device::signingSeed,
                    const char *domain = "smart-agro.telemetry.v2", const char *timeKey = "measured_at") {
  JsonDocument envelope;
  if (packet.isEmpty() || packet.length() > kEnvelopeLimit) return false;
  const auto envelopeError = deserializeJson(envelope, packet);
  if (envelopeError) return envelopeError == DeserializationError::NoMemory;
  const char *payload = envelope["payload"] | "";
  const char *encoded = envelope["signature"] | "";
  const size_t payloadLength = strlen(payload);
  uint8_t signature[64], publicKey[32];
  size_t decodedLength = 0;
  if (payloadLength == 0 || payloadLength > 4096 || strlen(encoded) != 88 ||
      mbedtls_base64_decode(signature, sizeof(signature), &decodedLength,
          reinterpret_cast<const unsigned char *>(encoded), 88) != 0 || decodedLength != sizeof(signature)) return false;
  Ed25519::derivePublicKey(publicKey, seed);
  if (!Ed25519::verify(signature, publicKey, payload, payloadLength)) return false;
  JsonDocument body;
  const auto payloadError = deserializeJson(body, payload);
  if (payloadError) return payloadError == DeserializationError::NoMemory;
  if (strcmp(body["domain"] | "", domain) != 0) return false;

  const char *stamp = body[timeKey] | "";
  tm date{};
  const char *end = strptime(stamp, "%Y-%m-%dT%H:%M:%SZ", &date);
  if (!end || *end != '\0') return false;
  const time_t measured = mktime(&date); // setup configures UTC.
  char canonical[25];
  if (!trustworthyEpoch(measured) || !strftime(canonical, sizeof(canonical), "%Y-%m-%dT%H:%M:%SZ", &date) ||
      strcmp(stamp, canonical) != 0) return false;
  return difftime(time(nullptr), measured) <= 7 * 24 * 60 * 60;
}

enum class Delivery { Retry, Acknowledged, Rejected };

// energy-ingest lives next to telemetry-ingest in the same project.
String energyEndpoint() {
  String endpoint = device::endpoint;
  endpoint.replace("/telemetry-ingest", "/energy-ingest");
  return endpoint;
}

Delivery deliver(const String &packet, bool energy = false) {
  WiFiClientSecure tls;
  tls.setCACert(device::rootCa);
  tls.setHandshakeTimeout(10);
  HTTPClient http;
  if (!http.begin(tls, energy ? energyEndpoint() : String(device::endpoint))) return Delivery::Retry;
  http.setConnectTimeout(10000);
  http.setTimeout(12000);
  http.addHeader("Content-Type", "application/json");
  // HTTP/1.0 avoids chunked bodies, which getStream() does not decode.
  http.useHTTP10(true);
  const int status = http.POST(packet);
  Delivery delivery = Delivery::Retry;
  if ((status == 200 || status == 400 || status == 409) && http.getSize() <= 512) {
    char response[513];
    const int contentLength = http.getSize();
    Stream &stream = http.getStream();
    stream.setTimeout(2500);
    const size_t requested = contentLength < 0 ? sizeof(response) : contentLength;
    const size_t received = stream.readBytes(response, requested);
    if (received < sizeof(response) && (contentLength < 0 || received == requested)) {
      JsonDocument result;
      if (!deserializeJson(result, response, received)) {
        const char *code = result["code"] | "";
        if (status == 200 && (result["ok"] | false) && validUuid(result[energy ? "window_id" : "packet_id"] | "")) {
          delivery = Delivery::Acknowledged;
        } else if (energy ? (status == 409 || (status == 400 && strcmp(code, "device_unavailable") != 0)) :
                   ((status == 400 && (strcmp(code, "timestamp_out_of_range") == 0 ||
                                      strcmp(code, "invalid_packet") == 0 || strcmp(code, "invalid_payload") == 0)) ||
                   (status == 409 && (strcmp(code, "sequence_conflict") == 0 ||
                                      strcmp(code, "sequence_out_of_order") == 0 ||
                                      strcmp(code, "unit_archived") == 0)))) {
          Serial.printf("Server rejected an envelope permanently: %s.\n", code);
          delivery = Delivery::Rejected;
        }
      }
    }
  }
  http.end();
  if (delivery == Delivery::Retry) Serial.printf("Queued envelope retained (HTTP %d).\n", status);
  return delivery;
}

// Writes through a temporary file, so a power cut never leaves half an envelope in the queue.
bool commitEnvelope(const String &packet, const char *path) {
  File file = LittleFS.open(kQueueTemp, FILE_WRITE);
  const bool written = file && file.write(reinterpret_cast<const uint8_t *>(packet.c_str()), packet.length()) == packet.length();
  if (file) file.close();
  File staged = LittleFS.open(kQueueTemp, FILE_READ);
  const bool complete = staged && staged.size() == packet.length();
  if (staged) staged.close();
  return written && complete && !LittleFS.exists(path) && LittleFS.rename(kQueueTemp, path);
}

// Reads the probes, signs one envelope and commits it to the queue as entry `id`.
bool storeSample(uint32_t id, String &packet, char (&path)[13]) {
  const SensorReading moisture = readMoisture();
  const SensorReading temperature = readTemperature();
  const SensorReading ph = readPh(moisture);
  const SensorReading battery = readBattery();
  const time_t epoch = time(nullptr);
  tm utc{};
  char measuredAt[25];
  if (!trustworthyEpoch(epoch) || !gmtime_r(&epoch, &utc) ||
      !strftime(measuredAt, sizeof(measuredAt), "%Y-%m-%dT%H:%M:%SZ", &utc)) return false;

  char bootId[37];
  newBootId(bootId);
  if (!makeTelemetryEnvelope(device::deviceId, device::unitId, bootId, 1, measuredAt, "synced",
                             moisture, temperature, ph, battery, device::signingSeed, packet)) {
    Serial.println("Telemetry could not be encoded.");
    return false;
  }
  queuePath('q', id, path);
  if (id == 0 || !commitEnvelope(packet, path)) {
    Serial.println("Telemetry could not be committed to flash.");
    return false;
  }
  return true;
}

void measureAndPublish(bool wifiConnected) {
  uint32_t ids[kQueueCapacity];
  size_t count = 0;
  if (!loadQueue('q', ids, count)) {
    Serial.println("Cannot read telemetry queue.");
    return;
  }
  size_t sent = 0;
  if (outbox.isKey(kPendingKey)) {
    // Preserve an entry when NVS could not read it. An actual empty value is a malformed packet.
    const String legacy = outbox.getString(kPendingKey, "\x01");
    if (legacy == "\x01") {
      Serial.println("Cannot read legacy envelope. Continuing with LittleFS queue.");
    } else {
      const bool invalid = !usableEnvelope(legacy);
      if (invalid) Serial.println("Discarding invalid or expired legacy envelope.");
      if (invalid || wifiConnected) {
        const bool retired = (invalid || deliver(legacy) != Delivery::Retry) && outbox.remove(kPendingKey);
        if (!invalid) ++sent;
        if (!retired) {
          Serial.println("Legacy envelope retained.");
          wifiConnected = false;
        }
      }
    }
  }

  // The newest sample goes first, so the app shows a current reading as soon as the node is back online,
  // instead of after hours of draining a backlog oldest-first. Every packet carries its own boot ID and
  // sequence 1, so the server accepts any delivery order. A full queue keeps the old order below.
  const bool room = count < kQueueCapacity;
  if (room) {
    char path[13];
    String packet;
    // A sample that cannot be stored is logged inside; the backlog below still drains.
    if (storeSample(count == 0 ? 1 : ids[count - 1] + 1, packet, path) && wifiConnected && sent < kEnvelopesPerWake) {
      ++sent;
      if (deliver(packet) == Delivery::Retry) wifiConnected = false;
      else if (!LittleFS.remove(path)) Serial.println("Envelope will be retried after flash removal failed.");
    }
  }

  size_t drained = 0;
  // ponytail: cap requests per wake until measured power and backlog justify adaptive draining.
  for (; drained < count && sent < kEnvelopesPerWake; ++drained) {
    char path[13];
    queuePath('q', ids[drained], path);
    File file = LittleFS.open(path, FILE_READ);
    if (!file) {
      Serial.printf("Cannot open queued envelope %s.\n", path);
      wifiConnected = false;
      break;
    }
    const size_t size = file.size();
    file.setTimeout(0);
    const String packet = size <= kEnvelopeLimit ? file.readString() : String();
    file.close();
    if (size <= kEnvelopeLimit && packet.length() != size) {
      Serial.printf("Cannot read queued envelope %s.\n", path);
      wifiConnected = false;
      break;
    }
    if (!usableEnvelope(packet)) {
      Serial.printf("Discarding invalid or expired envelope %s.\n", path);
    } else {
      if (!wifiConnected) break;
      ++sent;
      if (deliver(packet) == Delivery::Retry) {
        wifiConnected = false;
        break;
      }
    }
    if (!LittleFS.remove(path)) {
      Serial.printf("Retaining queue entry %s after delete failed.\n", path);
      wifiConnected = false;
      break;
    }
  }

  if (room) return;
  if (count - drained >= kQueueCapacity) {
    Serial.println("24-hour telemetry queue is full. New sample skipped.");
    return;
  }
  // The queue was full before draining: store this wake's sample behind the remaining backlog.
  char path[13];
  String packet;
  if (storeSample(drained == count ? 1 : ids[count - 1] + 1, packet, path) && wifiConnected &&
      drained == count && sent < kEnvelopesPerWake && deliver(packet) != Delivery::Retry && !LittleFS.remove(path)) {
    Serial.println("Envelope will be retried after flash removal failed.");
  }
}

// --- Energy evidence: two INA228 meters, one on the MPPT-to-battery path (solar harvest) and one on the battery-to-boost
// path (load). One meter cannot split the two: its ENERGY register adds power flowing either way.

double inaCurrentLsb() { return device::meterMaxAmps / 524288.0; }  // 2^19 steps of the 20-bit current result

long inaShuntCalValue() { return lround(13107.2e6 * inaCurrentLsb() * device::meterShuntOhms); }

bool energyEnabled() {
  bool seeded = false;
  for (uint8_t b : device::meterSeed) seeded = seeded || b != 0;
  const auto meter = [](uint8_t address) { return address >= 0x40 && address <= 0x4F; };
  return meter(device::solarMeterAddress) && meter(device::loadMeterAddress) &&
         device::solarMeterAddress != device::loadMeterAddress && validUuid(device::meterId) && seeded &&
         device::meterShuntOhms > 0 && device::meterMaxAmps > 0 &&
         device::meterMaxAmps * device::meterShuntOhms <= 0.16384 &&  // the +-163.84 mV shunt range
         inaShuntCalValue() > 0 && inaShuntCalValue() <= 0x7FFF;
}

bool inaRead(uint8_t address, uint8_t reg, uint16_t &value) {
  uint8_t data[2];
  if (!i2cRead(address, reg, data, sizeof(data))) return false;
  value = (data[0] << 8) | data[1];
  return true;
}

bool inaWrite(uint8_t address, uint8_t reg, uint16_t value) {
  const uint8_t data[2] = {static_cast<uint8_t>(value >> 8), static_cast<uint8_t>(value)};
  return i2cWrite(address, reg, data, sizeof(data));
}

// Resets the meter, which zeroes its accumulators, then sets the shunt calibration that the energy LSB depends on.
// The default ADC mode after reset converts bus, shunt and temperature continuously, so ENERGY keeps accumulating
// while the ESP32 sleeps.
bool inaStart(uint8_t address) {
  uint16_t maker, part;
  if (!inaRead(address, kInaMaker, maker) || maker != 0x5449 || !inaRead(address, kInaPart, part) ||
      (part >> 4) != 0x228 || !inaWrite(address, kInaConfig, 0x8000)) return false;
  delay(2);
  return inaWrite(address, kInaShuntCal, static_cast<uint16_t>(inaShuntCalValue())) &&
         inaWrite(address, kInaConfig, 0x4000);  // RSTACC: drop what accumulated before the calibration
}

bool inaCalibrated(uint8_t address) {
  uint16_t calibration;
  return inaRead(address, kInaShuntCal, calibration) && calibration == inaShuntCalValue();
}

bool inaEnergy(uint8_t address, uint64_t &raw) {
  uint8_t data[5];
  if (!i2cRead(address, kInaEnergy, data, sizeof(data))) return false;
  raw = 0;
  for (const uint8_t b : data) raw = (raw << 8) | b;
  return true;
}

double energyWh(uint64_t raw) { return raw * 16 * 3.2 * inaCurrentLsb() / 3600.0; }

// Deep sleep ends a minute early because the RTC slow clock drifts; the last stretch is light sleep, so the counters
// are read within about a second of the quarter-hour.
void waitForQuarterHour() {
  const time_t ahead = kQuarterHour - time(nullptr) % kQuarterHour;
  if (ahead == kQuarterHour || ahead > 2 * kWakeLeadSeconds) return;
  Serial.flush();
  esp_sleep_enable_timer_wakeup(static_cast<uint64_t>(ahead) * 1000000ULL);
  esp_light_sleep_start();
}

void queueEnergyWindow(time_t start, time_t end, uint64_t solarStart, uint64_t solarEnd, uint64_t loadStart,
                       uint64_t loadEnd) {
  uint32_t ids[kEnergyCapacity];
  size_t count = 0;
  if (!loadQueue('e', ids, count)) {
    Serial.println("Cannot read energy queue.");
    return;
  }
  if (count >= kEnergyCapacity) {
    Serial.println("24-hour energy queue is full. Window skipped.");
    return;
  }
  tm utc{};
  char startAt[25], endAt[25];
  if (!gmtime_r(&start, &utc) || !strftime(startAt, sizeof(startAt), "%Y-%m-%dT%H:%M:%SZ", &utc) ||
      !gmtime_r(&end, &utc) || !strftime(endAt, sizeof(endAt), "%Y-%m-%dT%H:%M:%SZ", &utc)) return;
  String packet;
  char path[13];
  queuePath('e', count == 0 ? 1 : ids[count - 1] + 1, path);
  if (!makeEnergyEnvelope(device::meterId, device::deviceId, energyBoot, static_cast<int32_t>(++energySequence),
                          startAt, endAt, energyWh(solarStart), energyWh(solarEnd), energyWh(loadStart),
                          energyWh(loadEnd), device::meterSeed, packet) || !commitEnvelope(packet, path)) {
    Serial.println("Energy window could not be stored.");
    return;
  }
  Serial.printf("Energy %s: solar %.4f Wh, load %.4f Wh.\n", startAt, energyWh(solarEnd) - energyWh(solarStart),
                energyWh(loadEnd) - energyWh(loadStart));
}

// On the quarter-hour with a trusted clock and the queue mounted: read both counters and, when the previous reading was
// the preceding quarter-hour of the same counting run, queue that 15-minute window.
void sampleEnergy(bool coldBoot) {
  const uint8_t solar = device::solarMeterAddress;
  const uint8_t load = device::loadMeterAddress;
  if (coldBoot || !energyBoot[0] || !inaCalibrated(solar) || !inaCalibrated(load)) {
    // A new counting run: power-on, or a meter lost power and forgot its calibration.
    energyMark = 0;
    energyBoot[0] = '\0';
    if (!inaStart(solar) || !inaStart(load)) {
      Serial.println("INA228 meters not found at the configured addresses.");
      return;
    }
    newBootId(energyBoot);
    energySequence = 0;
  }
  uint64_t solarRaw, loadRaw;
  if (!inaEnergy(solar, solarRaw) || !inaEnergy(load, loadRaw)) {
    Serial.println("INA228 energy counters could not be read.");
    energyMark = 0;
    return;
  }
  if (energyMark && (solarRaw < solarMarkRaw || loadRaw < loadMarkRaw)) {
    Serial.println("INA228 counters went backwards. A new counting run starts next wake.");
    energyBoot[0] = '\0';
    energyMark = 0;
    return;
  }
  const time_t now = time(nullptr);
  const time_t boundary = now - now % kQuarterHour;
  if (now - boundary > kBoundarySlackSeconds) {  // away from a quarter-hour: no window and no baseline
    energyMark = 0;
    return;
  }
  if (energyMark == boundary - kQuarterHour && energySequence < INT32_MAX) {
    queueEnergyWindow(energyMark, boundary, solarMarkRaw, solarRaw, loadMarkRaw, loadRaw);
  }
  energyMark = boundary;
  solarMarkRaw = solarRaw;
  loadMarkRaw = loadRaw;
}

// Oldest first and stop at the first retry: within a counting run the server refuses windows that overtake others.
void publishEnergy() {
  uint32_t ids[kEnergyCapacity];
  size_t count = 0;
  if (WiFi.status() != WL_CONNECTED || !loadQueue('e', ids, count)) return;
  for (size_t i = 0, sent = 0; i < count && sent < kEnvelopesPerWake; ++i) {
    char path[13];
    queuePath('e', ids[i], path);
    File file = LittleFS.open(path, FILE_READ);
    if (!file) return;
    const size_t size = file.size();
    file.setTimeout(0);
    const String packet = size <= kEnvelopeLimit ? file.readString() : String();
    file.close();
    if (size <= kEnvelopeLimit && packet.length() != size) return;
    if (usableEnvelope(packet, device::meterSeed, "smart-agro.energy.v1", "end_at")) {
      ++sent;
      if (deliver(packet, true) == Delivery::Retry) return;
    } else {
      Serial.printf("Discarding invalid or expired energy window %s.\n", path);
    }
    if (!LittleFS.remove(path)) return;
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  const uint32_t started = millis();
  setenv("TZ", "UTC0", 1);
  tzset();
  Wire.begin(21, 22);
  Wire.setTimeOut(100);
  analogSetPinAttenuation(kMoisturePin, ADC_11db);
  analogSetPinAttenuation(kPhPin, ADC_11db);
  analogSetPinAttenuation(kBatteryPin, ADC_11db);

  const bool energy = energyEnabled();
  bool clockTrusted = false;
  WifiCredentials wifi = storedWifi();
  if (esp_reset_reason() != ESP_RST_DEEPSLEEP && (wifi.ssid.isEmpty() || setupRequested())) {
    runSetupPortal();  // restarts after a save; otherwise the device carries on with what it has
    wifi = storedWifi();
  }

  const String endpoint = device::endpoint;
  bool seedConfigured = false;
  for (uint8_t b : device::signingSeed) seedConfigured = seedConfigured || b != 0;
  if (!endpoint.startsWith("https://") || !endpoint.endsWith("/functions/v1/telemetry-ingest") ||
      device::rootCa[0] == '\0' || wifi.ssid.isEmpty() || !seedConfigured ||
      !validUuid(device::deviceId) || !validUuid(device::unitId)) {
    Serial.println("USB diagnostics only. Provision the device to send telemetry.");
    readPh(readMoisture());
    const SensorReading temperature = readTemperature();
    if (temperature.error) Serial.println(temperature.error);
    else Serial.printf("Soil temperature: %.2f C\n", temperature.value);
  } else if (outbox.begin("smart-agro", false)) {
    const bool coldBoot = esp_reset_reason() != ESP_RST_DEEPSLEEP;
    // The meters count through deep sleep: read them on the quarter-hour from the RTC clock, before any radio load.
    if (energy && clockReady(false)) {
      clockTrusted = true;
      waitForQuarterHour();
      if (mountQueue()) {
        sampleEnergy(coldBoot);
        LittleFS.end();
      }
    }
    // With meters the node wakes every 15 minutes; soil readings and Wi-Fi stay on every other wake.
    const time_t wake = time(nullptr);
    if (!energy || coldBoot || !clockTrusted || lastTelemetry == 0 ||
        wake - lastTelemetry >= static_cast<time_t>(kIntervalSeconds) - kQuarterHour / 2) {
      lastTelemetry = wake;
      const bool wifiConnected = connectWifi(wifi);
      if (clockReady(wifiConnected)) {
        clockTrusted = true;
        lastClockUsed = time(nullptr);
        if (mountQueue()) {
          measureAndPublish(wifiConnected);
          if (energy) publishEnergy();
          LittleFS.end();
        } else {
          Serial.println("Telemetry flash partition could not be mounted.");
        }
      } else {
        Serial.println("UTC clock is unavailable. No timestamped sample stored.");
        readPh(readMoisture());
      }
    } else {
      lastClockUsed = time(nullptr);
    }
    outbox.end();
  } else {
    Serial.println("Persistent outbox is unavailable.");
  }

  WiFi.mode(WIFI_OFF);
  Serial.flush();
  const uint64_t intervalMs = kIntervalSeconds * 1000ULL;
  const uint64_t awakeMs = millis() - started;
  const time_t ahead = kQuarterHour - time(nullptr) % kQuarterHour;
  esp_sleep_enable_timer_wakeup(energy && clockTrusted
      ? static_cast<uint64_t>(ahead > kWakeLeadSeconds ? ahead - kWakeLeadSeconds : 1) * 1000000ULL
      : (awakeMs < intervalMs ? intervalMs - awakeMs : intervalMs) * 1000ULL);
  esp_deep_sleep_start();
}

void loop() {}

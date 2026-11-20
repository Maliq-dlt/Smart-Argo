#include <Arduino.h>
#include <algorithm>
#include <ArduinoJson.h>
#include <DallasTemperature.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <OneWire.h>
#include <Preferences.h>
#include <WiFi.h>
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
constexpr uint8_t kRtcAddress = 0x68;
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

bool trustworthyEpoch(time_t value) {
  return value >= kEarliestUtc && static_cast<int64_t>(value) < kLatestUtc;
}

bool readRtc(uint8_t reg, uint8_t *data, size_t length) {
  Wire.beginTransmission(kRtcAddress);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0 || Wire.requestFrom(kRtcAddress, length) != length) {
    return false;
  }
  for (size_t i = 0; i < length; ++i) {
    data[i] = Wire.read();
  }
  return true;
}

bool writeRtc(uint8_t reg, const uint8_t *data, size_t length) {
  Wire.beginTransmission(kRtcAddress);
  Wire.write(reg);
  Wire.write(data, length);
  return Wire.endTransmission() == 0;
}

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

bool connectWifi() {
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.begin(device::wifiSsid, device::wifiPassword);
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

void queuePath(uint32_t id, char (&path)[13]) {
  snprintf(path, sizeof(path), "/q%010lu", static_cast<unsigned long>(id));
}

bool loadQueue(uint32_t (&ids)[kQueueCapacity], size_t &count) {
  File root = LittleFS.open("/");
  if (!root || !root.isDirectory()) return false;
  for (File file = root.openNextFile(); file; file = root.openNextFile()) {
    const char *name = file.name();
    if (strlen(name) != 11 || name[0] != 'q' || strspn(name + 1, "0123456789") != 10) continue;
    const unsigned long long id = strtoull(name + 1, nullptr, 10);
    if (count == kQueueCapacity || id == 0 || id > UINT32_MAX) return false;
    ids[count++] = static_cast<uint32_t>(id);
  }
  std::sort(ids, ids + count);
  return true;
}

// Match the ingest window for permanently stale samples. Retry transport and provisioning failures while useful.
bool usableEnvelope(const String &packet) {
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
  Ed25519::derivePublicKey(publicKey, device::signingSeed);
  if (!Ed25519::verify(signature, publicKey, payload, payloadLength)) return false;
  JsonDocument body;
  const auto payloadError = deserializeJson(body, payload);
  if (payloadError) return payloadError == DeserializationError::NoMemory;
  if (strcmp(body["domain"] | "", "smart-agro.telemetry.v2") != 0) return false;

  const char *stamp = body["measured_at"] | "";
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

Delivery deliver(const String &packet) {
  WiFiClientSecure tls;
  tls.setCACert(device::rootCa);
  tls.setHandshakeTimeout(10);
  HTTPClient http;
  if (!http.begin(tls, device::endpoint)) return Delivery::Retry;
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
        if (status == 200 && (result["ok"] | false) && validUuid(result["packet_id"] | "")) {
          delivery = Delivery::Acknowledged;
        } else if ((status == 400 && (strcmp(code, "timestamp_out_of_range") == 0 ||
                                      strcmp(code, "invalid_packet") == 0 || strcmp(code, "invalid_payload") == 0)) ||
                   (status == 409 && (strcmp(code, "sequence_conflict") == 0 ||
                                      strcmp(code, "sequence_out_of_order") == 0))) {
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

void measureAndPublish(bool wifiConnected) {
  uint32_t ids[kQueueCapacity];
  size_t count = 0;
  if (!loadQueue(ids, count)) {
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

  size_t drained = 0;
  // ponytail: cap requests per wake until measured power and backlog justify adaptive draining.
  for (; drained < count && sent < kEnvelopesPerWake; ++drained) {
    char path[13];
    queuePath(ids[drained], path);
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

  if (count - drained >= kQueueCapacity) {
    Serial.println("24-hour telemetry queue is full. New sample skipped.");
    return;
  }
  const SensorReading moisture = readMoisture();
  const SensorReading temperature = readTemperature();
  const SensorReading ph = readPh(moisture);
  const time_t epoch = time(nullptr);
  tm utc{};
  char measuredAt[25];
  if (!trustworthyEpoch(epoch) || !gmtime_r(&epoch, &utc) ||
      !strftime(measuredAt, sizeof(measuredAt), "%Y-%m-%dT%H:%M:%SZ", &utc)) return;

  char bootId[37];
  newBootId(bootId);
  String packet;
  if (!makeTelemetryEnvelope(device::deviceId, device::unitId, bootId, 1, measuredAt, "synced",
                             moisture, temperature, ph, device::signingSeed, packet)) {
    Serial.println("Telemetry could not be encoded.");
    return;
  }
  const uint32_t id = drained == count ? 1 : ids[count - 1] + 1;
  char path[13];
  queuePath(id, path);
  File file = LittleFS.open(kQueueTemp, FILE_WRITE);
  const bool written = file && file.write(reinterpret_cast<const uint8_t *>(packet.c_str()), packet.length()) == packet.length();
  if (file) file.close();
  File staged = LittleFS.open(kQueueTemp, FILE_READ);
  const bool complete = staged && staged.size() == packet.length();
  if (staged) staged.close();
  if (!written || !complete || id == 0 || LittleFS.exists(path) || !LittleFS.rename(kQueueTemp, path)) {
    Serial.println("Telemetry could not be committed to flash.");
    return;
  }
  if (wifiConnected && drained == count && sent < kEnvelopesPerWake &&
      deliver(packet) != Delivery::Retry && !LittleFS.remove(path)) {
    Serial.println("Envelope will be retried after flash removal failed.");
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

  const String endpoint = device::endpoint;
  bool seedConfigured = false;
  for (uint8_t b : device::signingSeed) seedConfigured = seedConfigured || b != 0;
  if (!endpoint.startsWith("https://") || !endpoint.endsWith("/functions/v1/telemetry-ingest") ||
      device::rootCa[0] == '\0' || device::wifiSsid[0] == '\0' || !seedConfigured ||
      !validUuid(device::deviceId) || !validUuid(device::unitId)) {
    Serial.println("USB diagnostics only. Provision the device to send telemetry.");
    readPh(readMoisture());
    const SensorReading temperature = readTemperature();
    if (temperature.error) Serial.println(temperature.error);
    else Serial.printf("Soil temperature: %.2f C\n", temperature.value);
  } else if (outbox.begin("smart-agro", false)) {
    const bool wifiConnected = connectWifi();
    if (clockReady(wifiConnected)) {
      lastClockUsed = time(nullptr);
      if (mountQueue()) {
        measureAndPublish(wifiConnected);
        LittleFS.end();
      } else {
        Serial.println("Telemetry flash partition could not be mounted.");
      }
    } else {
      Serial.println("UTC clock is unavailable. No timestamped sample stored.");
      readPh(readMoisture());
    }
    outbox.end();
  } else {
    Serial.println("Persistent outbox is unavailable.");
  }

  WiFi.mode(WIFI_OFF);
  Serial.flush();
  const uint64_t intervalMs = kIntervalSeconds * 1000ULL;
  const uint64_t awakeMs = millis() - started;
  esp_sleep_enable_timer_wakeup((awakeMs < intervalMs ? intervalMs - awakeMs : intervalMs) * 1000ULL);
  esp_deep_sleep_start();
}

void loop() {}

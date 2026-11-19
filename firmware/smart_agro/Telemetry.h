#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <Ed25519.h>
#include <mbedtls/base64.h>

struct SensorReading {
    const char *status;
    double value;
    const char *error;
};

inline bool addSensor(JsonObject sensor, const SensorReading &reading, double low, double high) {
    sensor["status"] = reading.status;
    if (strcmp(reading.status, "ok") == 0) {
        if (!isfinite(reading.value) || reading.value < low || reading.value > high) return false;
        sensor["value"] = reading.value;
    } else {
        sensor["value"] = nullptr;
        if (strcmp(reading.status, "error") == 0) {
            if (!reading.error || !*reading.error || strlen(reading.error) > 240) return false;
            sensor["error"] = reading.error;
        } else if (strcmp(reading.status, "not_measured") != 0) {
            return false;
        }
    }
    return true;
}

inline bool makeTelemetryEnvelope(const char *deviceId, const char *unitId, const char *bootId,
                                  int32_t sequence, const char *measuredAt, const char *clockStatus,
                                  const SensorReading &moisture, const SensorReading &temperature,
                                  const SensorReading &ph, const uint8_t seed[32], String &envelope) {
    JsonDocument packet;
    packet["domain"] = "smart-agro.telemetry.v2";
    packet["schema_version"] = 2;
    packet["source"] = "device";
    packet["device_id"] = deviceId;
    packet["unit_id"] = unitId;
    packet["boot_id"] = bootId;
    packet["sequence"] = sequence;
    packet["measured_at"] = measuredAt;
    packet["clock_status"] = clockStatus;
    JsonObject sensors = packet["sensors"].to<JsonObject>();
    if (!addSensor(sensors["moisture"].to<JsonObject>(), moisture, 0, 100) ||
        !addSensor(sensors["soil_temperature"].to<JsonObject>(), temperature, -20, 60) ||
        !addSensor(sensors["soil_ph"].to<JsonObject>(), ph, 0, 14)) return false;

    String payload;
    const size_t length = measureJson(packet);
    if (packet.overflowed() || length > 4096 || serializeJson(packet, payload) != length) return false;

    uint8_t publicKey[32], signature[64];
    Ed25519::derivePublicKey(publicKey, seed);
    Ed25519::sign(signature, seed, publicKey, payload.c_str(), payload.length());
    unsigned char encoded[89];
    size_t encodedLength = 0;
    if (mbedtls_base64_encode(encoded, sizeof(encoded), &encodedLength, signature, sizeof(signature)) != 0) return false;

    JsonDocument outer;
    outer["payload"] = payload;
    outer["signature"] = reinterpret_cast<const char *>(encoded);
    envelope = "";
    const size_t outerLength = measureJson(outer);
    return !outer.overflowed() && outerLength <= 12288 && serializeJson(outer, envelope) == outerLength;
}

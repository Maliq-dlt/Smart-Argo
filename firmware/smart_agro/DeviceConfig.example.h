#pragma once

#include <Arduino.h>

namespace device {
constexpr char wifiSsid[] = "";
constexpr char wifiPassword[] = "";
// WPA2 key of the SmartAgro-xxxx setup network, 8-63 characters; provision.mjs generates one for the label.
constexpr char setupPassword[] = "";
constexpr char endpoint[] = "";
constexpr char rootCa[] = "";
constexpr char deviceId[] = "";
constexpr char unitId[] = "";
constexpr uint8_t signingSeed[32] = {};
constexpr int moistureDryMv = 0;
constexpr int moistureWetMv = 0;
constexpr int phLowMv = 0;
constexpr int phHighMv = 0;
// 2.0 when the RAB 47k/47k divider feeds the battery voltage to GPIO32; 0 when it is not wired.
constexpr float batteryDivider = 0;
// Energy evidence for energy-ingest: two INA228 boards, solar between the CN3791 and the battery, load between the
// battery and the MT3608. Both addresses 0 turn energy windows off and keep the 30-minute schedule.
constexpr uint8_t solarMeterAddress = 0;  // 0x40: A0 and A1 to GND
constexpr uint8_t loadMeterAddress = 0;   // 0x41: A0 to VS
constexpr float meterShuntOhms = 0.015f;  // the shunt fitted on the INA228 board; check the board's marking
constexpr float meterMaxAmps = 2.0f;      // highest current on either path; amps x ohms must stay under 0.16384 V
constexpr char meterId[] = "";            // UUID returned when an operator registers the meter public key
constexpr uint8_t meterSeed[32] = {};     // provision.mjs fills it; a key separate from signingSeed
}

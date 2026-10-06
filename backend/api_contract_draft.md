# API Contract — Smart Agro Backend
**Versi Draft 1 · Disusun oleh Fransisco (Backend) · 6 Oktober 2026**
**Status:** Menunggu persetujuan Noval (Tech Lead)

---

## Informasi Umum

| Item | Nilai |
|------|-------|
| Base URL (lokal) | `http://localhost:3000` |
| Format data | JSON (`Content-Type: application/json`) |
| Bahasa respons AI | Bahasa Indonesia |

---

## Daftar Endpoint

| # | Metode | Path | Fungsi |
|---|--------|------|--------|
| 1 | `GET` | `/health` | Cek apakah server hidup |
| 2 | `POST` | `/api/ai/explain` | Minta penjelasan AI dari snapshot sesi |
| 3 | `POST` | `/api/blockchain/record` | Catat hash bukti ke blockchain testnet |
| 4 | `POST` | `/api/blockchain/verify` | Verifikasi apakah hash cocok dengan transaksi |

---

## 1. Health Check

**`GET /health`**

Tidak perlu mengirim data apa pun. Endpoint ini digunakan untuk memastikan server backend menyala.

**Response (200):**
```json
{
  "success": true,
  "message": "Server Backend Smart Agro berjalan dengan baik!",
  "timestamp": "2026-10-06T08:00:00Z"
}
```

---

## 2. Penjelasan AI

**`POST /api/ai/explain`**

Frontend mengirimkan snapshot kondisi tanaman saat ini beserta keputusan dari mesin aturan. Backend meneruskan data ini ke model AI (Gemini API) dan mengembalikan penjelasan dalam bahasa Indonesia.

**Catatan penting:**
- Tindakan utama (siram/amati/periksa) tetap berasal dari mesin aturan, bukan dari AI.
- AI hanya **menjelaskan alasan** di balik keputusan tersebut.
- API key AI disimpan di backend (file `.env`), tidak pernah dikirim ke frontend.
- Data snapshot user A tidak pernah tercampur dengan user B.

**Request Body:**
```json
{
  "snapshot": {
    "profile": {
      "crop": "Cabai",
      "media": "Sekam bakar + kompos",
      "phase": "vegetatif"
    },
    "latest_sample": {
      "moisture": 55,
      "temp_c": 28.5,
      "ph": 6.5,
      "valid": true,
      "measured_at": "2026-10-06T08:00:00Z"
    },
    "samples_count": 48,
    "observed_hours": 24.0
  },
  "rule_decision": {
    "decision": "PERIKSA_SEBELUM_PERGI",
    "action": "Periksa sebelum pergi",
    "reason": "Perkiraan mencapai acuan: 1,33 jam",
    "evidence": {
      "eta_h": 1.33,
      "watering_response": "Respons siram terakhir normal.",
      "ph_status": "pH tervalidasi dalam 24 jam."
    }
  },
  "session_id": "uuid-sesi-abc123"
}
```

**Response — Sukses (200):**
```json
{
  "success": true,
  "explanation": "Kelembapan media saat ini berada di angka 55 dari skala 100. Berdasarkan kecepatan pengeringan yang teramati selama 24 jam terakhir, media diperkirakan mencapai batas kering dalam waktu sekitar 1 jam 20 menit. Karena itu, disarankan untuk memeriksa kondisi pot sebelum meninggalkannya dalam waktu lama.",
  "model": "gemini-2.0-flash",
  "responded_at": "2026-10-06T08:00:05Z"
}
```

**Response — Gagal (500 / 503):**
```json
{
  "success": false,
  "error": "Model AI tidak merespons dalam batas waktu.",
  "fallback": "Gunakan penjelasan dari mesin aturan yang sudah tersedia di frontend."
}
```

**Validasi yang dilakukan backend sebelum mengirim ke AI:**
- `snapshot.latest_sample.moisture` harus angka 0–100.
- `snapshot.latest_sample.temp_c` harus angka -10 sampai 60.
- `snapshot.latest_sample.ph` boleh `null` (tidak diukur) atau angka 0–14.
- `rule_decision.decision` tidak boleh kosong.
- Ukuran total request maksimal 64 KB.
- Timeout ke model AI: 15 detik.

---

## 3. Catat Bukti ke Blockchain

**`POST /api/blockchain/record`**

Frontend mengirimkan file JSON hasil ekspor sesi. Backend akan:
1. Menghitung hash SHA-256 dari byte UTF-8 file tersebut (tanpa mengubah isinya).
2. Mengirim transaksi bernilai 0 ke alamat wallet sendiri di testnet, dengan hash pada field `data`.
3. Menunggu receipt transaksi.
4. Mengembalikan bukti pencatatan.

**Catatan penting:**
- Wallet demo dipakai, tanpa dana/token nyata.
- Smart contract tidak diperlukan.
- File JSON asli disimpan di luar blockchain (hanya hash-nya yang dicatat).
- Jika file diubah walau 1 karakter, hash-nya akan berbeda dan verifikasi akan gagal.

**Request Body:**
```json
{
  "session_file": {
    "filename": "agro-P1-1696579200000.json",
    "content": "<isi lengkap file JSON ekspor sesi, sebagai string>"
  },
  "source": "simulation"
}
```

**Response — Sukses (200):**
```json
{
  "success": true,
  "record": {
    "file_hash": "0xa1b2c3d4e5f6...abc123",
    "chain_id": 11155111,
    "network": "Sepolia",
    "transaction_hash": "0x987654...xyz789",
    "block_number": 12345678,
    "recorded_at": "2026-10-06T08:01:30Z"
  }
}
```

**Response — Gagal (502):**
```json
{
  "success": false,
  "error": "Transaksi gagal: wallet menolak atau jaringan tidak tersedia."
}
```

**Validasi:**
- `session_file.content` tidak boleh kosong dan maksimal 2 MB.
- `source` harus salah satu dari: `"simulation"`, `"device"`.

---

## 4. Verifikasi Bukti Blockchain

**`POST /api/blockchain/verify`**

Frontend mengirimkan file JSON asli beserta data transaksi yang pernah dicatat. Backend akan menghitung ulang hash dari file, lalu memeriksa apakah hash tersebut cocok dengan data transaksi yang ada di blockchain.

**Request Body:**
```json
{
  "session_file_content": "<isi file JSON yang sama persis>",
  "transaction_hash": "0x987654...xyz789",
  "chain_id": 11155111
}
```

**Response — Cocok (200):**
```json
{
  "success": true,
  "verified": true,
  "message": "Hash file cocok dengan data transaksi di Sepolia block #12345678.",
  "file_hash": "0xa1b2c3d4e5f6...abc123"
}
```

**Response — Tidak Cocok (200):**
```json
{
  "success": true,
  "verified": false,
  "message": "Hash file TIDAK cocok. File kemungkinan telah diubah setelah pencatatan.",
  "file_hash": "0xbeda456...berbeda",
  "chain_hash": "0xa1b2c3d4e5f6...abc123"
}
```

---

## Catatan untuk Diskusi Tim

1. **Untuk Teofilus (Frontend):** Format `snapshot` di endpoint `/api/ai/explain` — apakah sudah sesuai dengan data yang tersedia di objek `PotCase` dan hasil `evaluate()` di `agronomyEngine.ts`? Jika ada field yang perlu ditambah/dikurangi, beri tahu.

2. **Untuk Malik (AI & Blockchain):** Endpoint `/api/blockchain/record` saat ini dirancang agar Malik tetap memegang kendali wallet. Apakah pengiriman transaksi dilakukan backend secara otomatis, atau Malik ingin menyetujui setiap transaksi secara manual lewat wallet?

3. **Untuk Noval (Tech Lead):** Apakah perlu ditambahkan middleware CORS agar frontend di `localhost:5173` bisa memanggil backend di `localhost:3000`? Jika ya, saya akan tambahkan.

---

*Dokumen ini adalah draft. Silakan beri komentar atau revisi sebelum saya mulai mengimplementasikan endpoint-endpointnya.*

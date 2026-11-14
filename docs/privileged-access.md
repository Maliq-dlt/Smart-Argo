# Akses operator dan kurator

Kontrak backend tahap 4, 14 November 2026. Hak privileged tetap diberikan oleh operator database tepercaya melalui `account.access_roles`; caller tidak dapat memberikan role kepada dirinya sendiri. Tahap ini tidak menambahkan UI, enrollment otomatis, provisioning hardware, atau pemulihan authenticator.

## Membaca data privileged

Scope lintas akun untuk operator dan kurator memerlukan sesi Auth aktif, factor TOTP berstatus verified, dan JWT dengan assurance `aal2`. Role saja tidak cukup. Role `owner` dan `contributor` tetap tersedia sesuai otorisasi biasa; kegagalan memenuhi gate privileged tidak menutup alur enrollment MFA di Auth.

`my_curation_roles()` menyaring `operator`/`curator` yang belum memenuhi gate tersebut. Scope antrean kurasi dan RLS kontribusi memakai role tersaring. Workspace energi dan reward juga harus memakai scope privileged yang sama untuk data lintas akun. Akses pemilik terhadap data miliknya tetap mengikuti gate sesi/MFA dan ownership yang sudah ada.

Freshness lima menit tidak berlaku untuk membaca scope privileged. JWT AAL2 tidak menghapus kebutuhan sesi database yang masih aktif atau factor verified yang masih terdaftar.

## Menulis sebagai operator atau kurator

Operasi sensitif memerlukan seluruh syarat baca privileged dan bukti TOTP pada claim `amr` JWT yang masih berumur maksimum lima menit menurut jam database. Autentikasi password baru atau sekadar refresh JWT bukan pengganti challenge TOTP baru.

RPC yang memakai gate ini:

- `review_profile_contribution`;
- `operator_register_energy_meter` dan `operator_revoke_energy_meter`;
- `operator_set_reward_policy` dan `operator_upsert_catalog`;
- `operator_fulfill_redemption` dan `operator_compensate_redemption`.

Caller melakukan challenge/verify TOTP melalui Supabase Auth menggunakan factor miliknya, lalu memakai access token AAL2 hasil verifikasi pada RPC. Jangan mengirim secret TOTP atau kode authenticator sebagai argumen RPC database; jangan menyimpan secret di source atau log.

Gate write diulang sesudah lock resource yang relevan diperoleh, tepat sebelum mutasi pertama. Urutan lock helper adalah account actor, factor TOTP dengan urutan ID tetap, lalu sesi Auth, sesuai urutan unenroll pada versi GoTrue yang dipakai. Sesudah lock diperoleh, helper memeriksa role, sesi, factor, AAL dan waktu TOTP kembali. Ini mencegah hasil pemeriksaan sebelum menunggu lock dipakai sebagai izin yang sudah kedaluwarsa. Gate memakai jam aktual database, bukan waktu awal transaksi.

Tidak ada hold 24 jam khusus untuk operasi privileged. Hold pada penukaran poin atau transfer kepemilikan merupakan kebijakan terpisah dan tetap berlaku pada alurnya sendiri. Gate ini tidak mengubah hak service-role pada ingest telemetry/energi; service-role tidak boleh dibagikan kepada browser.

## Error dan retry

Seperti RPC existing, HTTP 200 dapat berisi `{ok:false,code,message}`. Periksa `ok`, bukan hanya status HTTP, dan jangan bergantung pada teks `message`.

- `unauthorized`: sesi tidak aktif atau gate sesi/MFA umum tidak terpenuhi. Pengguna yang sudah mempunyai factor verified tetapi memakai token AAL1 lama juga mendapat kode ini; selesaikan verifikasi TOTP dan gunakan token AAL2 baru.
- `forbidden`: account tidak mempunyai role yang diperlukan.
- `mfa_required`: tidak ada factor TOTP verified; selesaikan enrollment dan verifikasi factor terlebih dahulu.
- `step_up_required`: sesi AAL2 masih aktif, tetapi claim `amr` TOTP hilang, kedaluwarsa, malformed, atau bertanggal masa depan. Lakukan challenge/verify lagi dan gunakan token baru.

Validasi domain, konflik revisi dan larangan self-review tetap dapat menghasilkan error yang sudah ada sebelum mencapai gate write. Helper gate internal tidak diberi hak execute langsung kepada role browser; caller tetap memakai RPC domain.

Jika respons mutasi hilang, baca keadaan tersimpan dan ikuti aturan retry/idempotensi RPC domain tersebut. Step-up tidak membuat operasi yang sebelumnya non-idempoten menjadi idempoten.

## Cakupan tahap ini

Perubahan dibatasi pada tujuh RPC write di atas serta scope privileged pada `knowledge_workspace`, `energy_workspace` dan `reward_workspace`, termasuk policy RLS kurasi yang memakai role tersaring. Ini memperkuat otorisasi fungsi existing; tidak menambah use case produk, provisioning/rotasi/revokasi perangkat, atau monitoring offline. Skor cakupan use case tidak dinaikkan oleh tahap keamanan ini.

## Batas verifikasi

Suite kurasi memakai signup Auth nyata, enrollment/verification TOTP nyata, database dan PostgREST lokal. Fixture agronomi tetap sintetis; MFA tidak membuktikan kompetensi kurator atau ketepatan profil. Suite privileged memeriksa penolakan role tanpa MFA, JWT lama, sesi/role dicabut dan akses antrean lintas akun. Hasil command dan jumlah test harus mengikuti laporan eksekusi terakhir, bukan dianggap lulus hanya karena dokumen ini tersedia.

Backend ini belum menyediakan recovery codes atau support recovery kehilangan TOTP. Tetapkan prosedur operasional pemulihan sebelum mewajibkan kebijakan ini pada operator hosted yang sudah aktif; penerapan lokal tidak membuktikan konfigurasi Auth hosted.

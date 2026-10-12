# wa-gateway

## Reminder follow-up lead (IM-DMU & DMC)

`src/wa/followupReminderService.js` — tiap 15 menit (WIB) poll dua feed dan kirim
reminder ke grup sales untuk lead yang belum di-follow up:

| Sumber | Feed | Reminder biasa | Hard warning (tag nomor) |
|---|---|---|---|
| **DMU** — lead IM-DMU yang belum ada follow-up sama sekali | im-dmu `GET /api/followup-reminders` | `24h` — 24 jam sejak lead masuk | `48h` — 48 jam sejak lead masuk |
| **DMC** — Lead Follow-Up sponsor (Send Sponsor Kit → Follow-up 1 → Follow-up 2) | DMC `GET /api/lead-followup-reminders` | `due_soon` — ≤24 jam ke deadline SLA step-nya | `overdue` — deadline SLA lewat |

SLA DMC mengikuti `deadline_at` yang sudah dipakai menu Lead Follow-Up: Send
Sponsor Kit 48 jam sejak lead dibuat, Follow-up 1/2 tujuh hari sejak step
sebelumnya. Jadi untuk Send Sponsor Kit, `due_soon` = 24 jam dan `overdue` = 48 jam,
sama seperti DMU.

Aplikasi sumber yang menentukan lead mana yang perlu diingatkan (aturannya ada di
docblock `FollowupReminderController` (im-dmu) dan
`API\LeadFollowupReminderController` (DMC), plus README im-dmu). Lead yang sudah
di-follow up / pindah step tidak muncul lagi di feed. wa-gateway hanya mencatat
yang sudah terkirim di tabel `followup_reminders` (unik per source + lead +
trigger + stage), jadi tiap stage hanya terkirim sekali. Semua lead per stage
digabung jadi satu pesan (maks. 20 lead, sisanya di tick berikutnya).

Tidak butuh crontab — jadwalnya jalan di dalam proses Node (`node-cron`), jadi
cukup app-nya hidup. Tabel `followup_reminders` dibuat otomatis saat boot
(`sequelize.sync()`).

### Setup

1. **Aplikasi sumber** (`.env`, lalu `php artisan config:clear`):
   - im-dmu: `FOLLOWUP_REMINDER_API_KEY=<secret>` dan
     `FOLLOWUP_REMINDER_SINCE=<tanggal go-live>`
   - DMC: `LEAD_REMINDER_API_KEY=<secret>` dan
     `LEAD_REMINDER_SINCE=<tanggal go-live>`

   `*_SINCE` wajib — tanpa itu feed menolak jalan (503). Lead/step yang mulai
   sebelum tanggal itu tidak pernah diingatkan, supaya backlog lama tidak
   membanjiri grup.
2. **wa-gateway `.env`**: `DMU_REMINDER_API_KEY` (= `FOLLOWUP_REMINDER_API_KEY`
   im-dmu) dan `DMC_REMINDER_API_KEY` (= `LEAD_REMINDER_API_KEY` DMC). Restart app.
3. **Menu Reminders** (`/reminders`) — satu kartu per sumber:
   - status: API key di `.env`, device READY, grup, hasil tick terakhir (termasuk error,
     mis. `API HTTP 401` = key tidak cocok)
   - pilih device, pilih grup (tombol **Pilih** memuat daftar grup dari device),
     nomor yang di-tag di hard warning, jam tenang (default `20-8`: tidak kirim
     jam 20:00–07:59 WIB; yang tertahan dikirim jam 08:00), URL feed
   - **Preview pesan** — lihat pesan yang AKAN dikirim, tanpa mengirim/mencatat
   - **Kirim sekarang** — kirim langsung (abaikan status aktif & jam tenang)
   - centang **Aktifkan auto reminder** + Simpan paling akhir, setelah preview benar
   - di bawahnya: riwayat 50 reminder terakhir yang terkirim

   Setting yang sama tersimpan di `app_settings` (`DMU_REMINDER_*` / `DMC_REMINDER_*`,
   juga muncul di /settings). Endpoint di balik tombolnya:
   `POST /api/admin/followup-reminders/run?source=dmu|dmc[&dry=1]`.

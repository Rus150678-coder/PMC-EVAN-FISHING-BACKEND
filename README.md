# PMC EVAN FISHING V3.5 — GitHub + Render Backend

Backend khusus untuk:
- Admin API: lihat booking, edit nama, ubah status DP/LUNAS, delete/unlock.
- Supabase Auth + tabel `public.admins` untuk otorisasi Admin.
- WhatsApp Cloud API webhook untuk perintah `BOOKING <1-32> <NAMA>`.
- Health check: `/health`.

## 1. Upload ke GitHub

Buat repository baru, misalnya:

`PMC-EVAN-FISHING-BACKEND`

Upload **isi folder ini** ke root repository. Jangan upload file `.env` atau secret.

Struktur repository:

```text
PMC-EVAN-FISHING-BACKEND/
├── package.json
├── server.js
├── render.yaml
├── .gitignore
├── .env.example
└── README.md
```

## 2. Deploy di Render

Di Render pilih **New + → Web Service**, lalu pilih repository GitHub tersebut.

Build Command:

`npm install`

Start Command:

`npm start`

Health Check Path:

`/health`

## 3. Environment Variables Render

Isi langsung di Render. Jangan commit secret ke GitHub dan jangan kirim secret ke chat.

- `SUPABASE_URL` = URL project Supabase.
- `SUPABASE_ANON_KEY` = Publishable key Supabase.
- `SUPABASE_SECRET_KEY` = Supabase Secret key (server only).
- `WA_VERIFY_TOKEN` = token rahasia buatan sendiri untuk verifikasi webhook.
- `WA_ACCESS_TOKEN` = access token WhatsApp Cloud API.
- `WA_PHONE_NUMBER_ID` = Phone Number ID dari Meta WhatsApp.
- `WA_GRAPH_VERSION` = versi Graph API yang sedang digunakan oleh konfigurasi Meta Anda.
- `PORT` = 10000 (Render juga menyediakan PORT secara otomatis).

`server.js` juga menerima nama variabel lama `SUPABASE_SERVICE_ROLE_KEY` sebagai fallback, tetapi untuk project Supabase baru gunakan `SUPABASE_SECRET_KEY`.

## 4. Test backend

Setelah deploy, buka:

`https://NAMA-SERVICE.onrender.com/health`

Harus mengembalikan JSON dengan `ok: true`.

## 5. Admin

Halaman Admin Netlify V3.5 harus diarahkan ke URL Render tersebut. Login menggunakan user Supabase Auth yang UID-nya sudah dimasukkan ke `public.admins`.

## 6. WhatsApp

Webhook URL:

`https://NAMA-SERVICE.onrender.com/webhook/whatsapp`

Verify Token di Meta harus sama dengan `WA_VERIFY_TOKEN` di Render.

Contoh pesan:

`BOOKING 7 BUDI`

Nomor yang sudah terisi akan ditolak. Booking baru akan disimpan sebagai `BELUM BAYAR` dan terkunci dari sisi publik.

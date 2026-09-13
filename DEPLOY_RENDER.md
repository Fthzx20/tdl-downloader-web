# 🚀 Deploy ke Render.com (Backend) + Vercel (Frontend)

## ❓ Apakah Render bakal kena Pause / Sleep?

**Jawabannya: YA, pada Plan Gratis Render (Free Tier):**
- Jika tidak ada request selama **15 menit**, Render akan otomatis **"Spin Down" (Sleep)**.
- Ketika ada pengguna yang membuka web lagi, Render membutuhkan waktu **30–50 detik untuk bangun (*Cold Start*)**.

---

### 🛡️ Trik 100% GRATIS Agar Render TIDAK PERNAH Pause (24/7 Selalu Aktif)
Anda bisa mencegah Render dari *pause/sleep* dengan menggunakan pinger otomatis gratis:
1. Buka **[Cron-Job.org](https://cron-job.org)** atau **[UptimeRobot.com](https://uptimerobot.com)** (Gratis selamanya).
2. Buat Monitor Baru:
   - **URL:** `https://NAMA-BACKEND-ANDA.onrender.com/`
   - **Interval:** Setiap **5 atau 10 menit sekali**.
3. **Hasil:** Pinger otomatis akan mengirim ping ringan ke backend Anda setiap 5 menit, sehingga Render menganggap server selalu digunakan dan **TIDAK AKAN PERNAH SLEEP/PAUSE sama sekali!**

---

## 🛠️ Langkah-Langkah Deploy Backend FastAPI ke Render.com

### Langkah 1: Push Kode Proyek ke GitHub
Upload folder `web_backend` dan `web_frontend` Anda ke repository GitHub (bisa Public maupun Private).

---

### Langkah 2: Deploy Backend ke Render
1. Buka dan login di **[render.com](https://render.com)**.
2. Di Dashboard, klik **New +** ➔ **Web Service**.
3. Pilih **Build and deploy from a Git repository** ➔ Hubungkan repository GitHub Anda.
4. Isi konfigurasi Web Service:
   - **Name:** `tdl-rip-backend` (atau nama bebas)
   - **Region:** `Singapore` (paling cepat untuk Asia/Indonesia)
   - **Root Directory:** `web_backend`
   - **Environment:** `Python 3`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn server:app --host 0.0.0.0 --port $PORT`
   - **Instance Type:** `Free` ($0/mo)
5. Klik **Create Web Service**.
6. Render akan memproses selama 1-2 menit dan memberikan URL HTTPS gratis, contoh:
   `https://tdl-rip-backend.onrender.com`

---

## 🛠️ Langkah-Langkah Deploy Frontend ke Vercel

1. Buka **[vercel.com](https://vercel.com)** dan login menggunakan akun GitHub Anda.
2. Klik **Add New...** ➔ **Project**.
3. Import repository GitHub proyek ini.
4. Pada bagian **Root Directory**, pilih folder `web_frontend`.
5. Tambahkan **Environment Variable**:
   - **Key:** `NEXT_PUBLIC_API_BASE`
   - **Value:** `https://tdl-rip-backend.onrender.com` (URL Render Backend Anda)
6. Klik **Deploy**.
7. Vercel akan memproses selama 1 menit dan memberikan domain HTTPS gratis!

# Panduan Deploy Backend ke Back4App (100% Gratis Tanpa Kartu Kredit)

Panduan ini untuk men-deploy backend Python FastAPI ke **Back4App Containers** (tier gratis, tanpa meminta verifikasi kartu debit/kredit sama sekali).

---

## Langkah 1: Daftar / Login di Back4App
1. Buka [https://www.back4app.com/](https://www.back4app.com/).
2. Klik tombol **Sign Up** di kanan atas.
3. Pilih **Continue with GitHub** (otomatis terverifikasi via akun GitHub Anda, **tanpa kartu kredit/debit**).

---

## Langkah 2: Buat Container App Baru
1. Di Dashboard Back4App, klik tombol **"Create a new App"** (atau New App).
2. Pilih tipe: **"Containers as a Service (CaaS)"** (atau Web App).
3. Beri nama aplikasi Anda, misal: `tdl-downloader-backend`.

---

## Langkah 3: Hubungkan Repository GitHub
1. Hubungkan akun GitHub Anda dan pilih repository project ini (`tdl-rip-web`).
2. Pilih Branch: `main` (atau `master`).
3. Pada pengaturan Build:
   * **Root Directory**: Kosongkan atau biarkan `./`
   * **Dockerfile Path**: `./Dockerfile` (atau `./web_backend/Dockerfile`)

---

## Langkah 4: Atur Port & Environment Variables
1. **Port Container**:
   * Masukkan Port: **`8000`**
2. **Environment Variables**:
   Tambahkan variabel berikut di tab *Environment Variables*:

| Key | Value Contoh | Keterangan |
| :--- | :--- | :--- |
| `PORT` | `8000` | Port uvicorn |
| `PYTHONUNBUFFERED` | `1` | Agar log tampil real-time |
| `MAX_CONCURRENT_DOWNLOADS` | `2` | Optimalisasi hemat RAM 256 MB |
| `R2_ENABLED` | `true` *(opsional)* | Jika menggunakan R2 |
| `R2_ACCOUNT_ID` | `xxxx` *(opsional)* | Dari config.json / Cloudflare |
| `R2_ACCESS_KEY_ID` | `xxxx` *(opsional)* | Dari config.json / Cloudflare |
| `R2_SECRET_ACCESS_KEY` | `xxxx` *(opsional)* | Dari config.json / Cloudflare |
| `R2_BUCKET_NAME` | `xxxx` *(opsional)* | Nama bucket R2 Anda |

---

## Langkah 5: Deploy & Ambil URL Publik
1. Klik tombol **"Create App"** / **"Deploy"**.
2. Back4App akan otomatis mengunduh dependencies dan menjalankan container Docker Anda (proses biasanya 2–3 menit).
3. Setelah statusnya menjadi **Available / Running** (hijau), salin link URL publik Back4App Anda (contoh: `https://tdl-downloader-backend-xxxx.b4a.run`).

---

## Langkah 6: Hubungkan ke Frontend (Vercel)
1. Buka dashboard [Vercel](https://vercel.com/dashboard) pada project Frontend Anda.
2. Masuk ke **Settings** -> **Environment Variables**.
3. Edit nilai **`NEXT_PUBLIC_API_BASE`** dan masukkan URL dari Back4App tadi (contoh: `https://tdl-downloader-backend-xxxx.b4a.run`).
4. Klik **Save**, lalu lakukan **Redeploy** pada project Frontend Vercel Anda.

Selesai! Seluruh sistem kini berjalan 100% gratis tanpa pusing verifikasi kartu bank!

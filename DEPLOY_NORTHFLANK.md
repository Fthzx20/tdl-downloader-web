# Panduan Deploy Backend ke Northflank (100% Gratis 24/7)

Panduan ini untuk men-deploy backend Python FastAPI ke **Northflank** menggunakan **Developer Free Tier** (RAM 512 MB, CPU 0.2–0.4 vCPU, server nyala 24/7 tanpa sleep).

---

## Langkah 1: Buat Akun & Project di Northflank
1. Buka [Northflank](https://northflank.com/) dan login menggunakan akun **GitHub** Anda.
2. Di dashboard, klik tombol **"Create Project"**.
3. Beri nama project (misal: `tdl-downloader`) dan pilih region terdekat (misal: **Europe** atau **US Central**).
4. Klik **"Create Project"**.

---

## Langkah 2: Buat Service Baru (Combined Service / Web Service)
1. Di dalam project yang baru dibuat, klik **"Create Service"** -> pilih **"Combined Service"** (atau Deployment Service).
2. Beri nama service, misal: `tdl-backend`.
3. Di bagian **Build Source**:
   * Pilih **Repository**.
   * Hubungkan akun GitHub Anda dan pilih repository project ini (`tdl-rip-web`).
   * Pilih branch utama Anda (misal: `main` atau `master`).
4. Di bagian **Build Type**:
   * Pilih **Dockerfile**.
   * Jika build dari root: Northflank akan otomatis mendeteksi file `Dockerfile`.
   * (Opsional) Dockerfile path: `/Dockerfile` atau `/web_backend/Dockerfile` dengan Build Context `/web_backend`.
5. Di bagian **Deployment Plan & Resources**:
   * Pilih tier **Developer (Free)**: `0.2 - 0.4 vCPU` dan `512 MB RAM`.

---

## Langkah 3: Atur Networking & Port
1. Scroll ke bagian **Networking**:
   * Klik **"Add Port"**.
   * **Port number**: Ketik `8000`.
   * **Protocol**: Pilih `HTTP`.
   * Centang **"Publicly Accessible"** (agar bisa diakses dari web browser/frontend).
2. Northflank akan otomatis mengaktifkan HTTPS/SSL gratis.

---

## Langkah 4: Isi Environment Variables
Di tab **Environment Variables** pada service Anda, tambahkan variabel berikut (sesuaikan dengan akun Anda):

| Key | Value Contoh | Keterangan |
| :--- | :--- | :--- |
| `PORT` | `8000` | Port aplikasi |
| `PYTHONUNBUFFERED` | `1` | Optimasi log Python |
| `R2_ENABLED` | `true` *(opsional)* | Aktifkan jika pakai Cloudflare R2 |
| `R2_ACCOUNT_ID` | `xxxx` *(opsional)* | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | `xxxx` *(opsional)* | Cloudflare Access Key |
| `R2_SECRET_ACCESS_KEY` | `xxxx` *(opsional)* | Cloudflare Secret Key |
| `R2_BUCKET_NAME` | `xxxx` *(opsional)* | Nama bucket R2 |

---

## Langkah 5: Deploy & Hubungkan ke Frontend Vercel
1. Klik tombol **"Create Service"** di pojok kanan bawah untuk memulai proses build dan deploy.
2. Tunggu 1–2 menit hingga status berubah menjadi **Healthy** (hijau).
3. Salin URL publik yang diberikan Northflank (misal: `https://tdl-backend--xxxx.code.run`).
4. Buka dashboard **Vercel** pada project Frontend Anda:
   * Masuk ke **Settings** -> **Environment Variables**.
   * Ubah nilai **`NEXT_PUBLIC_API_BASE`** menjadi URL Northflank Anda (misal: `https://tdl-backend--xxxx.code.run`).
   * Klik **Save**, lalu lakukan **Redeploy** pada project Frontend Vercel Anda.

Selesai! Backend Anda sekarang berjalan 24 jam nonstop di Northflank secara gratis dan stabil!

# 🚀 Deploy TDL Rip Web to Hugging Face Spaces (100% Gratis Tanpa Beli Server)

Hugging Face Spaces menyediakan **Docker Space Gratis** dengan spesifikasi:
- **CPU:** 2 vCPU
- **RAM:** 16 GB
- **Storage:** 50 GB
- **Domain HTTPS/SSL Gratis**

---

## 🛠️ Langkah-Langkah Deployment (4 Langkah Mudah)

### Langkah 1: Buat Akun & Space Baru di Hugging Face
1. Daftar/Login di [huggingface.co/join](https://huggingface.co/join).
2. Klik foto profil di pojok kanan atas -> **New Space**.
3. Isi data Space:
   - **Space Name:** `tdl-music-downloader` (atau nama lain sesuai keinginan)
   - **License:** `MIT`
   - **Select the Space SDK:** Pilih **Docker** (Blank template)
   - **Space Hardware:** Pilih **Free (CPU basic · 2 vCPU · 16 GB RAM)**
   - **Visibility:** Pilih **Public** atau **Private** (Private tetap 100% gratis jika ingin digunakan sendiri)
4. Klik **Create Space**.

---

### Langkah 2: Push Kode ke Hugging Face Git Repository

Buka Terminal/PowerShell di komputer Anda, lalu jalankan perintah berikut:

```bash
# 1. Clone repository Space Hugging Face Anda
git clone https://huggingface.co/spaces/USERNAME_ANDA/tdl-music-downloader

# 2. Salin seluruh file dari folder proyek ini (web_backend, web_frontend, Dockerfile) ke dalam folder repo hasil clone

# 3. Masuk ke folder repo Hugging Face
cd tdl-music-downloader

# 4. Commit & Push file ke Hugging Face
git add .
git commit -m "Deploy TDL Rip Web ke Hugging Face Spaces"
git push
```

---

### Langkah 3: Tunggu Proses Build Otomatis
1. Setelah `git push`, Hugging Face akan otomatis membaca file `Dockerfile` yang ada di proyek.
2. Proses build Docker container membutuhkan waktu sekitar **2-3 menit**.
3. Status di halaman Space akan berubah dari `Building` menjadi `Running` (hijau).

---

### Langkah 4: Buka Aplikasi Web Online Anda!
Aplikasi Web TDL Rip kini sudah **ONLINE 24/7** dan bisa diakses dari HP Android/iOS maupun PC manapun di dunia via URL:
`https://USERNAME_ANDA-tdl-music-downloader.hf.space`

Selamat menikmati downloader Tidal online gratis tanpa biaya server! 🎉

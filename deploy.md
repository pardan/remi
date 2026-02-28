# Remi Indonesia - Panduan Deploy Multiplayer

Game Remi Multiplayer (Node.js + Socket.IO) sudah selesai dan berjalan sempurna di lokal. Sekarang saatnya untuk deploy agar bisa dimainkan bersama teman dari device manapun.

## Rekomendasi Hosting: **Railway.app** (Gratis & Paling Mudah)

Railway adalah platform cloud hosting yang sangat mudah digunakan untuk aplikasi Node.js.

### Langkah-langkah:

1. **Buat Git Repository**
   - Buka GitHub (github.com) dan buat repository kosong baru bernama `remi-online`.
   - Di komputer (folder `remi`), inisialisasi git dan push kodenya:
     ```bash
     git init
     git add .
     git commit -m "Initial commit - Remi Multiplayer"
     git branch -M main
     git remote add origin https://github.com/[username-kamu]/remi-online.git
     git push -u origin main
     ```

2. **Daftar Railway**
   - Buka [railway.app](https://railway.app) dan login menggunakan akun GitHub.

3. **Deploy Project**
   - Di dashboard Railway, klik **New Project**.
   - Pilih **Deploy from GitHub repo**.
   - Pilih repository `remi-online` yang baru saja kamu buat.
   - Klik **Deploy Now**.
   - Railway akan otomatis mendeteksi bahwa ini adalah aplikasi Node.js (melalui `package.json` dan `server.js`) dan akan langsung menginstalnya lalu menjalankannya secara otomatis.

4. **Dapatkan URL Publik**
   - Setelah deploy selesai (warna hijau), klik project tersebut.
   - Pergi ke tab **Settings** -> **Networking** atau **Domains**.
   - Klik **Generate Domain** untuk mendapatkan URL gratis dari Railway.
   - (Contoh: `remi-online-production.up.railway.app`)

5. **Mulai Bermain!**
   - Bagikan URL tersebut ke teman-temanmu. Masing-masing buka dari browser (HP/Laptop).
   - Satu orang klik **Host Game** dan akan mendapatkan *"Kode Room"*.
   - Pemain lain klik **Join Game** lalu masukkan kode tersebut.
   - Saat ada 4 pemain di room, game akan langsung dimulai otomatis secara sinkron!

---

*Catatan: File-file single player versi lama (`index.html`, `style.css`, dll yang ada di root) sudah dihapus bersih. Struktur sekarang murni Node.js server (`server.js`) yang me-serve client di dalam folder `public/`.*

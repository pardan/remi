# Panduan Deploy Remi Indonesia 🚀

Game Remi Anda sekarang sudah memiliki file konfigurasi otomatis bawaan untuk di-hosting secara gratis di platform yang menduku WebSockets seperti **Render** dan **Railway**.

### 🎉 Pilihan 1: Deploy ke Render.com (Gratis & Disarankan)
Render adalah platform gratis terbaik untuk menghosting server Node.js + Socket.IO Anda.
1. Buat repositori baru di GitHub dan *push* (unggah) seluruh kode Anda ke sana.
2. Daftar/login ke [Render.com](https://render.com/).
3. Klik tombol **New +** lalu pilih **Blueprint**.
4. Hubungkan dengan akun GitHub Anda dan pilih repositori berisi game Remi Anda.
5. Render akan otomatis membaca file `render.yaml` yang baru saja saya buatkan, dan memproses pengaturan aplikasinya.
6. Tunggu proses build selesai, lalu klik tautan *Web Service* yang diberikan. Selesai!

### 🚂 Pilihan 2: Deploy ke Railway.app (Sangat Cepat & Stabil)
Railway menawarkan kecepatan yang jauh lebih ngebut tanpa waktu "tertidur" di paket *tier* kredit gratis bulanan.
1. Buat repositori baru di GitHub dan *push* (unggah) seluruh kode Anda.
2. Buka [Railway.app](https://railway.app/).
3. Klik tombol **New Project**, lalu pilih **Deploy from GitHub repo**.
4. Pilih repositori game Anda.
5. Railway akan otomatis menggunakan pedoman build dari file `railway.json` secara instan.
6. Setelah di-deploy, buka klik layanan NodeJS dan tekan tab **Settings** -> **Generate Domain** untuk mendapatkan URL publiknya.

---

> [!WARNING]
> Jangan lupa untuk mengunggah *(commit dan push)* seluruh kode Anda ke **GitHub** terlebih dahulu sebelum menggunakan layanan Render atau Railway! Jangan khawatir, kedua file konfigurasi tersebut (`render.yaml` dan `railway.json`) sudah ada di dalam folder proyek Anda.

# Remi Indonesia
Sebuah implementasi game kartu klasik **Remi Indonesia** berbasis web, multiplayer, dan real-time. Mainkan bersama teman atau lawan bot cerdas secara langsung dari browser Anda atau bahkan dari handphone!

## ✨ Fitur Utama
- **🌍 Multiplayer Online**: Bermain bersama hingga 4 pemain melalui teknologi Socket.IO.
- **📱 Responsif & Nyaman di HP**: Tampilan dikalibrasi agar sempurna dimainkan di PC maupun handphone
- **🤖 Lawan Bot (AI)**: Bermain melawan 3 Bot cerdas yang paham strategi bermain, termasuk strategi cekih.
- **⚡ Gameplay Real-time**: Semua aksi tersinkronisasi sempurna tanpa jeda.
- **⚠️ Sistem Cekih Manual (Tombol)**: Pemain harus **menekan tombol "Cekih!"** untuk mendeklarasikan bahwa ia berpotensi menang dari kartu buangan lawan. Jika valid, badge CEKIH muncul dan lawan target mendapat peringatan. Lihat detail lengkap di bagian Aturan.
- **🔄 Urutan Giliran Dinamis**: Ronde pertama dimulai oleh pembuat *room*, ronde selanjutnya oleh pemain dengan poin tertinggi.
- **🔊 Efek Suara Lengkap**: Sound effects untuk kartu dibagikan, penarikan, pembuangan, notifikasi giliran, efek *panic attack* saat cekih, dan *gunshot* jika idle terlalu lama.
- **🎬 Animasi Kartu**: Animasi smooth berbasis GSAP untuk dealing, drawing, dan discarding kartu.
- **🚪 Late Join**: Pemain baru bisa bergabung ke game yang sudah berjalan — host dapat menerima/menolak dan memilih pemain yang digantikan.
- **📊 Overtake Rule**: Pemain yang sudah ≥100 poin dan di-overtake oleh pemain lain akan ter-reset ke 0.
- **🃏 Tris Four**: Jika setelah Joker di-reveal, pemain belum pernah turun dan seluruh 7 kartunya bisa membentuk meld sempurna, langsung menang +300.

## 🛠️ Syarat Sistem
Pastikan Anda telah memasang:
- [Node.js](https://nodejs.org/) (Versi 14 atau lebih baru)

## 🚀 Instalasi & Menjalankan Game
1. Clone / unduh repositori ini:
   ```bash
   git clone https://github.com/USERNAME/REPO_NAME.git
   cd REPO_NAME
   ```
2. Instal semua dependensi:
   ```bash
   npm install
   ```
3. Jalankan server lokal:
   ```bash
   npm start
   ```
4. Buka browser (di PC atau HP) lalu kunjungi:
   ```
   http://localhost:3000
   ```

## 🎮 Cara Bermain (Lobby)
- **Host Game (Buat Room)**: Klik "Host Game" untuk membuat meja baru. Bagikan Kode Room ke teman Anda.
- **Join Game (Gabung Room)**: Masukkan Kode Room teman untuk ikut bermain.
- **Play with Bot**: Bermain instan melawan 3 Bot tanpa menunggu orang lain.
- **Late Join**: Jika game sudah dimulai, pemain baru bisa request bergabung — host memutuskan apakah menerima dan siapa yang digantikan.

## 🃏 Aturan Dasar Remi Indonesia
1. **Deck & Pembagian**: 1 Deck kartu remi standar (52 kartu) dibagikan untuk 4 orang (masing-masing 7 kartu).
2. **Kombinasi Kartu (Meld)**: Kumpulkan minimal 3 kartu untuk bisa "Turun". Kombinasi bisa berupa *Run* (bunga sama, angka berurutan) atau *Set* (angka/gambar sama, beda bunga).
3. **Syarat Turun Pertama**: Turun pertama kali **wajib** menggunakan Run, atau Set 4 As.
4. **Giliran Bermain**: Setiap giliran, Anda **harus** mengambil kartu (dari Deck atau buangan lawan), kemudian membuang 1 kartu.
5. **Joker Rule**: Kartu Joker ditaruh terbuka di bawah Deck sebagai acuan kartu liar. Joker bebas menggantikan kartu apa saja. Membuang Joker akan terkena denda poin!
6. **Poin**: Angka = 5, J/Q/K = 10, As = 15. Joker yang dibuang = penalti sesuai rank.

### ⚠️ Sistem Cekih (Manual)
Cekih adalah fitur unik Remi Indonesia di mana pemain yang membuang kartu yang dipakai lawan untuk menang akan terkena penalti.

- **Tombol Cekih**: Pemain menekan tombol **"⚠️ Cekih!"** untuk mendeklarasikan bahwa ia berpotensi menang dari kartu buangan target.
- **Validasi Server**: Server mengecek apakah deklarasi valid. Jika tidak, muncul pesan error.
- **Badge & Panic Sound**: Jika valid, badge CEKIH muncul di semua client. Efek suara *panic attack* aktif saat giliran pemain yang menjadi target cekih.
- **Timing Rule**: Cekih **hanya bisa di-declare saat bukan giliran sendiri**. Jika sudah giliran Anda, tombol otomatis disabled — artinya Anda terlambat menyadari potensi cekih.
- **Auto-Invalidasi**: Jika kondisi cekih berubah (misal lawan meld sehingga kondisi tidak lagi valid), deklarasi otomatis di-reset. Pemain perlu klik tombol lagi jika kondisi kembali valid. Validasi ini **tidak dilakukan** selama giliran pemain yang sudah declare, hanya setelah gilirannya berakhir.
- **Tanpa Tombol = Tanpa Penalti**: Jika pemain menang lewat tutup deck via discard pickup tapi **tidak menekan tombol cekih**, pemain yang membuang kartu **tidak** terkena penalti cekih.
- **Bot Cekih**: Bot juga otomatis menekan tombol cekih saat mendeteksi potensi cekih.

## 💻 Teknologi yang Digunakan
- **Backend:** Node.js, Express, Socket.IO
- **Frontend:** HTML5, CSS3, Vanilla JavaScript, Socket.IO Client
- **Animasi:** GSAP (GreenSock Animation Platform)

## 📝 Lisensi
© 2026 Silaturahmi Gaming. All rights reserved.

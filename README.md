# Remi Indonesia
Sebuah implementasi game kartu klasik **Remi Indonesia** berbasis web, multiplayer, dan real-time. Mainkan bersama teman atau lawan bot cerdas secara langsung dari browser Anda atau bahkan dari handphone!

## ✨ Fitur Utama
- **🌍 Multiplayer Online**: Bermain bersama hingga 4 pemain melalui teknologi Socket.IO.
- **📱 Responsif & Nyaman di HP**: Tampilan antar muka dikalibrasi agar sempurna dimainkan baik di PC, maupun di layar handphone (mendukung mode *Portrait* dan *Landscape* otomatis).
- **🤖 Lawan Bot (AI)**: Ingin bermain sendiri? Tersedia fitur bermain melawan 3 sistem Bot (Bot 1, Bot 2, Bot 3) yang paham strategi bermain.
- **⚡ Gameplay Real-time**: Perubahan status permainan, undian kartu, buangan kartu tersinkronisasi sempurna tanpa jeda.
- **🎯 Sistem "Cekih"**: Mengadaptasi aturan Remi asli di mana pemain yang memberikan kartu buangan yang dipakai untuk "Tutup Deck" oleh lawan akan mendapat denda penalti poin (Cekih).
- **🔄 Urutan Giliran Dinamis**: Ronde pertama dimulai oleh pembuat *room*, dan di ronde-ronde selanjutnya, pemain dengan poin tertinggi otomatis mendapat giliran pertama jalan.
- **🔊 Efek Suara**: Dilengkapi *sound effects* untuk kartu dibagikan, penarikan, pembuangan, notifikasi giliran, hingga efek peringatan (Joker).

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
- **Host Game (Buat Room)**: Klik "Host Game" untuk membuat meja baru. Bagikan Kode Room (contoh: `REM-ABCD`) ke teman-teman Anda.
- **Join Game (Gabung Room)**: Masukkan Kode Room teman Anda untuk ikut bermain di meja mereka.
- **Play with Bot**: Klik tombol ini untuk langsung bermain secara instan melawan 3 Bot tanpa menunggu orang lain.

## 🃏 Aturan Dasar Remi Indonesia
1. **Urutan Deck**: 1 Deck kartu remi standar (52 kartu) dibagikan untuk 4 orang (masing-masing 7 kartu).
2. **Kombinasi Kartu (Meld)**: Kumpulkan minimal 3 kartu untuk bisa "Turun". Kombinasi bisa berupa *Seri / Run* (Bunga sama, angka berurutan) atau *Set* (Angka/Gambar sama, beda bunga).
3. **Syarat Turun Pertama**: Untuk turun pertama kali ke meja, Anda Wajib menggunakan Seri / Run, atau set 4 gambar As.
4. **Giliran Bermain**: Di setiap giliran, Anda HARUS mengambil kartu (dari Deck tertutup ATAU kartu buangan lawan), kemudian membuang 1 kartu.
5. **Cekih (Penalti Buangan)**: Jika Anda mengambil kartu buangan lawan dan langsung menggunakannya untuk habis/menang (Tutup Deck), maka lawan yang membuang kartu tersebut akan terkena penalti poin (-50 hingga -500 tergantung jenis kartu).
6. **Joker Rule**: Kartu Joker ditaruh terbuka di bawah tumpukan Deck (sebagai acuan kartu liar). Joker bebas diganti apa saja. Hati-hati, Anda tidak boleh sembarangan membuang Joker kecuali rela kena denda poin besar!

## 💻 Teknologi yang Digunakan
- **Backend:** Node.js, Express, Socket.IO
- **Frontend:** HTML5, CSS3, Vanilla JavaScript (tanpa framework), Socket.IO Client

## 📝 Lisensi
MIT License

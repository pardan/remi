# Remi Indonesia
Sebuah implementasi game kartu klasik **Remi Indonesia** berbasis web, multiplayer, dan real-time. Mainkan bersama teman atau lawan bot cerdas secara langsung dari browser Anda atau dari handphone (mendukung orientasi Portrait maupun Landscape)!

## ✨ Fitur Utama
- **🌍 Multiplayer Online**: Bermain bersama 4 pemain secara real-time yang didukung oleh backend kencang berbasis **PartyKit** (WebSockets).
- **📱 Responsif (Mobile-first)**: Tampilan UI sepenuhnya beradaptasi untuk PC, perangkat tablet, maupun Handphone (mendukung posisi *miring/Landscape* dan *berdiri/Portrait* dengan *stacking* otomatis elemen UI).
- **🤖 Lawan Bot (AI)**: Bermain melawan 3 Bot cerdas yang paham strategi turun, membuang kartu, dan auto-cekih.
- **😆 Emoji & Emoticon Interaktif**: Berkirim emotikon animasi antar pemain selama permainan (lengkap dengan suara dan animasi *floating* melayang ke atas/bawah).
- **⚠️ Sistem Cekih Manual**: Pemain memencet tombol "Cekih!" jika memiliki potensi menang dari kartu buangan lawan, mengirim sinyal bahaya (beserta sirine panik) ke pemain target yang membuang kartu ceroboh.
- **🔄 Urutan Giliran Dinamis**: Ronde pertama dimulai oleh pembuat *room*, ronde selanjutnya oleh pemenang ronde sebelumnya dengan poin putaran tertinggi.
- **🔊 Efek Suara (Audio) Lengkap**: BGM, bunyi membagikan kartu (*deal*), kartu dipilih, sirine bahaya (*panic*), *gunshot* (jika kelamaan jalan/AFK), dan efek suara gabung/keluar game (Join & Leave).
- **🎬 Animasi Mulus**: Efek dealing (*fly-in*) dan penarikan kartu berbasis pure CSS Transition & Keyframes.
- **🚪 Late Join (Bergabung Tengah Jalan)**: Pemain telat bisa gabung ke *room* yang sedang jalan (dan menggantikan identitas salah satu Bot jika diizinkan Host).

## 🛠️ Syarat Sistem
Pastikan Anda telah memasang:
- [Node.js](https://nodejs.org/) (Direkomendasikan versi terbaru)

## 🚀 Instalasi & Menjalankan Game Lokal
1. Clone / unduh repositori ini:
   ```bash
   git clone https://github.com/USERNAME/REPO_NAME.git
   cd REPO_NAME
   ```
2. Instal semua dependensi:
   ```bash
   npm install
   ```
3. Jalankan server lokal (menggunakan PartyKit dev-server):
   ```bash
   npx partykit dev
   # Atau: npm run dev
   ```
4. Buka browser (di PC atau HP) lalu kunjungi alamat IP lokal/localhost yang tertera di terminal.

## 🚢 Deployment (Online)
Karena menggunakan **PartyKit**, menaikkannya ke internet menjadi sangat mudah dan serverless (jalan di atas infrastruktur Cloudflare). Cukup jalankan:
```bash
npx partykit deploy
# Atau: npm start
```

## 🎮 Cara Bermain (Lobby)
- **Host Game (Buat Room)**: Klik "Host Game" untuk membuat meja baru. Bagikan *Kode Room* berserta URL Anda ke teman.
- **Join Game (Gabung Room)**: Masukkan nama dan *Kode Room* teman untuk ikut bermain.
- **Play with Bot**: Bermain instan sendirian melawan 3 Bot tanpa koneksi orang lain.
- **Room Master Controls**: Pembuat room memiliki panel "Pengaturan (⚙️)" dengan fungsi _Restart Round_ dan _Restart Game_ untuk seluruh pemain.

## 🃏 Aturan Dasar Remi Indonesia
1. **Deck & Pembagian**: 1 Deck kartu remi standar dibagikan untuk 4 orang (masing-masing 7 kartu di tangan).
2. **Turunan (Meld)**: Kumpulkan minimal 3 kartu untuk bisa "Turun". Bisa berupa **Seri / Run** (Bunga sama, urutan nyambung) atau **Set / Tris** (Angka/Gambar sama, bunga beda).
3. **Syarat Turun Perdana**: Turun pertama kali *wajib* mencakup kombinasi Seri, atau menggunakan Set dari 4 lembar As.
4. **Alur Giliran**: Setiap giliran, harus **Ambil 1+ Kartu** (dari Deck / tarik dari susunan Buangan secara cerdik) lalu **Buang 1 Kartu**.
5. **Aturan Joker**: Ada 1 kartu spesifik yang dipilih server di awal ronde untuk menjadi "Joker Liar" pengganti kartu apa saja (Namun membuangnya ke buangan dikenakan minus poin berat!).
6. **Perolehan Poin**: Angka = (5 pts), J/Q/K = (10 pts), As = (15 pts). Di akhir babak, seluruh kartu turun milik pemain dihitung +poin, sisanya yang masih ada di tangan akan memakan -poin.

## 💻 Teknologi yang Digunakan
- **Backend / Networking:** [PartyKit](https://partykit.io/) (WebSockets serverless) + Node.js
- **Frontend UI & Rendering:** HTML5, CSS3, ES6 Vanilla JavaScript (Module)
- **Komponen Game:** Object-Oriented JS Classes (`ServerGame`, `RemiClient`, `server-bot.js`)

## 📝 Lisensi
© 2026 Silaturahmi Gaming. All rights reserved.

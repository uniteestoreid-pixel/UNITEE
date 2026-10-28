# SPK Generator — pengembangan dengan opsi Supabase Cloud

## Status saat ini

Proyek dipertahankan menggunakan HTML, CSS, dan JavaScript tanpa framework frontend baru. Formulir order, enam kelompok ukuran (dewasa/anak; pendek/panjang/3/4), preview dokumen A4, empat slot logo, arsip, edit, duplikasi, penghapusan, paste gambar, backup/restore JSON, ekspor JPG, serta cetak / Simpan sebagai PDF melalui dialog cetak browser tetap tersedia.

Versi ini menambahkan integrasi client Supabase yang **aktif setelah konfigurasi proyek Supabase disediakan**: login, registrasi akun, reset kata sandi, workspace, anggota/peran, PostgreSQL, upload Storage privat, nomor SPK melalui RPC yang atomik, penyimpanan SPK beserta rincian ukuran/approval dalam satu RPC, deteksi konflik versi, backup cloud yang mengunduh gambar ke JSON, serta migrasi arsip lokal. Tanpa konfigurasi Supabase, aplikasi tetap bekerja dalam mode lokal dan secara jelas memberi tahu bahwa datanya hanya berada di browser.

**Belum dapat dinyatakan siap produksi atau sudah ter-deploy:** belum ada kredensial/proyek Supabase milik pemilik aplikasi untuk menjalankan migration dan menguji Auth/RLS/Storage nyata. Browser automation end-to-end juga belum bisa dijalankan pada lingkungan audit ini. Pengujian yang benar-benar dijalankan tercantum di bagian terakhir.

## Menjalankan lokal

1. Ekstrak ZIP.
2. Jalankan server statis dari folder proyek, contohnya `python -m http.server 8000`.
3. Buka `http://localhost:8000`.
4. Tanpa pengaturan Supabase, halaman berjalan dalam mode lokal. Gunakan **Backup JSON** dan simpan hasilnya di lokasi lain secara berkala.

`npm run check` melakukan pemeriksaan sintaks JavaScript dan pemeriksaan statis file HTML/JS/SQL. `npm run build` membuat folder `dist/` untuk deployment; untuk melayani build hasil konfigurasi cloud secara lokal, jalankan server statis dengan folder `dist/` sebagai root.

## Konfigurasi Supabase untuk Cloud

1. Buat proyek Supabase baru atau gunakan proyek yang sudah ditinjau dan dicadangkan.
2. Di Supabase, buka SQL Editor dan jalankan `supabase/migrations/202610270001_initial_schema.sql` **satu kali**. Migration ini membuat tabel, RPC, RLS, private Storage bucket `spk-files`, dan policy akses file.
3. Buka Authentication → URL Configuration. Set Site URL ke domain aplikasi dan tambahkan URL redirect aplikasi (contoh `https://domain-kamu.vercel.app/`) sebagai allowed redirect. Reset password memakai URL halaman yang sedang dibuka.
4. Ambil **Project URL** dan **anon/public key** dari Supabase. Jangan pernah memasukkan `service_role` key ke browser.
5. Untuk deployment Vercel, set environment variables berikut pada Project Settings → Environment Variables untuk Production dan Preview:
   - `SUPABASE_URL` — URL proyek Supabase.
   - `SUPABASE_ANON_KEY` — anon/public key Supabase.
6. Set Framework Preset `Other`, Build Command `npm run build`, Output Directory `dist` lalu deploy. `build-config.cjs` akan menyalin hanya aset publik yang diperlukan ke `dist/` dan menghasilkan `dist/config.js` dari environment variables. `vercel.json` men-deploy folder `dist/`, bukan seluruh source tree. Jika kedua variabel kosong, build memberi peringatan dan hasilnya hanya mode lokal. Set kedua variabel atau kosongkan keduanya; jangan hanya mengisi salah satu.
7. Coba daftar akun pertama. Konfirmasikan email jika diminta, lalu login. Jika belum tergabung di workspace, buat workspace; pembuat menjadi admin workspace.
8. Untuk menambah anggota: minta anggota membuat akun dahulu, salin UUID pada panel akunnya, lalu masukkan UUID tersebut ke panel admin. Admin dapat menetapkan role `Anggota` atau `Admin`; backend memvalidasi izin. Ini merupakan mekanisme penambahan pengguna berdasarkan UUID, bukan undangan email otomatis.

> `dist/config.js` berisi URL dan anon/public key yang dirancang untuk dipakai di browser. RLS dan Storage policy adalah batas keamanan. Jangan pernah menaruh secret/service-role key dalam `config.js`, environment frontend, atau ZIP publik.

## Data lokal dan migrasi

- Key arsip lokal: `spk_generator_data_v3`.
- Key logo lokal: `spk_generator_logos_v1`.
- Saat pertama kali berpindah ke cloud pada browser yang sama, aplikasi menyimpan snapshot awal ke key `spk_generator_precloud_records_v1` dan `spk_generator_precloud_logos_v1` sebelum cache cloud menggantikan arsip tampilan. Snapshot ini tidak otomatis dihapus.
- Setelah masuk ke workspace, gunakan **Migrasikan arsip lokal ke cloud**. Data baru diberi ID/nomor cloud baru agar tidak menabrak nomor arsip di server. Kegagalan tiap record dihitung dan dicatat ke console; backup lokal tetap dipertahankan.
- Untuk memindahkan data ke browser/perangkat lain, buat file Backup JSON lebih dahulu dan pindahkan file itu secara manual. Jangan hapus data lokal sebelum memeriksa arsip cloud serta backup hasil ekspor.

## Backup dan pemulihan

- Mode lokal: Backup JSON mencakup records, rincian ukuran, catatan, approval, logo, dan gambar yang tersimpan di data URL browser.
- Mode cloud: Backup JSON mencoba mengunduh gambar privat dari Supabase Storage lalu menyertakan gambar sebagai data URL. Backup gagal dengan pesan error jika file yang diperlukan tidak dapat diunduh; jangan memperlakukan export sebagai lengkap jika file tidak berhasil dihasilkan.
- Impor lokal menggabungkan record dan melewati ID/nomor duplikat. Impor cloud membuat record baru dengan ID dan nomor cloud baru; periksa jumlah `ditambahkan` dan `dilewati` setelah impor. Mode impor cloud saat ini adalah mode gabung; mode pemulihan penuh yang mengganti seluruh isi workspace belum disediakan agar arsip tidak terhapus tidak sengaja.
- Backup JSON bukan pengganti backup database terjadwal. Konfigurasikan dan uji backup/restore database pada dashboard Supabase sesuai paket/fitur proyek yang digunakan. Backup file dan database harus dijaga bersama agar file Storage dapat dipulihkan.
- Penghapusan SPK adalah soft delete di database untuk menghindari penghapusan langsung record secara permanen. File yang tak lagi dipakai dapat menjadi orphan; jangan menghapus objek Storage manual tanpa memastikan tidak ada SPK yang masih mereferensikannya.

## Keamanan dan perilaku

- Semua tabel data penting mengaktifkan RLS; mutasi SPK melalui RPC `save_spk` dan `delete_spk`, yang memeriksa `auth.uid()`, keanggotaan workspace, batas input, ID/workspace, nomor SPK, jumlah ukuran, dan versi record.
- Nomor SPK dikeluarkan server dengan counter per workspace/tanggal; gap dapat terjadi bila pengguna membatalkan draft, tetapi nomor yang dikeluarkan tidak digunakan ulang oleh counter.
- File menggunakan private bucket dan signed URL yang kedaluwarsa; URL yang disimpan sementara dalam cache browser dimuat ulang saat login berikutnya.
- Jika dua pengguna mengubah record yang sama dengan versi berbeda, save ditolak dan memberi pesan konflik; aplikasi tidak menimpa perubahan secara diam-diam. Buka kembali versi yang sudah dimuat ulang sebelum melanjutkan.
- Role admin tidak ditentukan di frontend. Pembuatan workspace pertama memberi admin kepada pembuat; penambahan/perubahan anggota hanya melalui RPC admin yang memeriksa role.
- Login publik tersedia karena layar menyediakan tombol Buat akun. Pengguna baru tidak dapat membaca workspace yang sudah ada; ia hanya menjadi anggota setelah admin menambahkan UUID-nya.
- Versi logo baru diunggah ke path berbeda; snapshot SPK tetap menunjuk versi lama. File versi lama dipertahankan untuk menjaga dokumen historis.

## Keterbatasan yang belum diverifikasi

- Migration harus diuji di proyek Supabase nyata, termasuk pemeriksaan policy storage lama jika proyek sebelumnya sudah berisi policy lain.
- Belum ada pengujian dua akun nyata, uji isolasi workspace, uji upload Storage, uji pemulihan database, atau deploy produksi karena kredensial/akun layanan tidak disediakan.
- E2E browser lokal di lingkungan kerja diblokir kebijakan browser (`ERR_BLOCKED_BY_ADMINISTRATOR`); karena itu, audit otomatis yang dijalankan di sini dibatasi ke pemeriksaan statis dan sintaks.
- Arsip cloud dimuat bertahap dengan pagination 500 record per halaman. Alur formulir saat ini menyimpan satu gambar desain utama per SPK; dukungan beberapa gambar per SPK belum diimplementasikan.
- Ekspor PDF menggunakan dialog cetak browser dan pengguna memilih “Save as PDF”; ini bukan pembangkitan PDF langsung di aplikasi.
- Admin menambahkan akun yang sudah terdaftar berdasarkan UUID. Pengiriman invite email otomatis melalui Auth Admin API/Edge Function belum dibuat.
- Backup database terjadwal dan pemulihan Storage otomatis bergantung pada layanan/paket yang dipilih serta masih harus dikonfigurasi dan dites.

## Hasil pemeriksaan pada paket ini

- `node --check script.js` — lulus.
- `node --check cloud.js` — lulus.
- `node --check config.js` — lulus.
- Build menghasilkan `dist/` yang hanya berisi aset frontend dan `config.js`; berkas migration dan dokumentasi pengembangan tidak disertakan ke output publik.
- Pemeriksaan statis ID HTML, selector JS, aset lokal, serta marker RPC/RLS — dijalankan lewat `npm run check`.
- `npm run build` — lulus dalam mode lokal tanpa kredensial; perintah menghasilkan `config.js` dan memberi peringatan bahwa cloud belum aktif. Uji smoke konfigurasi dengan nilai contoh sementara juga lulus; nilai contoh tidak disertakan dalam konfigurasi akhir.
- `vercel.json` dan `package.json` — format JSON valid.
- Browser automation end-to-end diblokir oleh lingkungan; login Supabase nyata, eksekusi migration SQL di server, uji RLS antarakun, upload Storage nyata, dan deploy Vercel belum dilakukan.

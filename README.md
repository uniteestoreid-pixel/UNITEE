# SPK Generator — pengembangan dengan opsi Supabase Cloud

## Status saat ini

Proyek menggunakan HTML, CSS, dan JavaScript tanpa framework frontend baru. Formulir order, enam kelompok ukuran (dewasa/anak; pendek/panjang/3/4), preview dokumen A4, empat slot logo, arsip, edit, duplikasi, penghapusan, paste gambar, backup/restore JSON, ekspor JPG, serta cetak / Simpan sebagai PDF melalui dialog cetak browser tetap tersedia.

Supabase aktif untuk login, workspace, anggota/peran, PostgreSQL, Storage privat, nomor SPK atomik, penyimpanan SPK dan detailnya, deteksi konflik versi, backup cloud, serta migrasi arsip lokal. Setiap perubahan formulir dipulihkan dari IndexedDB pada browser yang sama. SPK tersimpan di database bersama semua anggota workspace; draft yang belum disimpan tetap terikat ke akun, workspace, dan browser pembuatnya.

GitHub Actions menjalankan pemeriksaan lalu menerbitkan situs ke GitHub Pages setiap ada perubahan pada `main`. Tanpa konfigurasi Supabase, aplikasi tetap berjalan dalam mode lokal dan memberi tahu bahwa datanya hanya berada di browser.

## Menjalankan lokal

1. Ekstrak ZIP.
2. Jalankan server statis dari folder proyek, contohnya `python -m http.server 8000`.
3. Buka `http://localhost:8000`.
4. Tanpa pengaturan Supabase, halaman berjalan dalam mode lokal. Gunakan **Backup JSON** dan simpan hasilnya di lokasi lain secara berkala.

`npm run check` melakukan pemeriksaan sintaks JavaScript dan pemeriksaan statis file HTML/JS/SQL. `npm run build` membuat folder `dist/` untuk deployment; untuk melayani build hasil konfigurasi cloud secara lokal, jalankan server statis dengan folder `dist/` sebagai root.

## Konfigurasi Supabase untuk Cloud

1. Gunakan proyek Supabase yang sudah memiliki tabel, RPC, RLS, dan bucket privat `spk-files`. Migrasi dasar tersedia di `supabase/migrations/20261028074039_initial_spk_generator_schema.sql`; ID file diselaraskan dengan satu migrasi yang tercatat di database aktif. Tinjau policy yang sudah ada sebelum menerapkannya pada proyek lain.
2. Buka Authentication → URL Configuration. Set Site URL ke domain aplikasi dan tambahkan URL GitHub Pages sebagai allowed redirect. Reset password memakai URL halaman yang sedang dibuka.
3. Ambil **Project URL** dan **anon/public key** dari Supabase. Jangan pernah memasukkan `service_role` key ke browser.
4. GitHub Actions saat ini menerima konfigurasi publik melalui environment workflow:
   - `SUPABASE_URL` — URL proyek Supabase.
   - `SUPABASE_ANON_KEY` — anon/public key Supabase.
5. Workflow `Deploy SPK Generator to GitHub Pages` membangun `dist/` lalu menerbitkannya. URL produksi: <https://uniteestoreid-pixel.github.io/UNITEE/>.
6. Akun harus menjadi anggota aktif workspace untuk membaca arsip. Untuk berbagi dengan akun lain, minta pengguna mendaftar dahulu, salin UUID di panel akunnya, lalu tambahkan dari panel admin. Setelah ditambahkan, akun tersebut memilih workspace yang sama atau menekan **Muat ulang workspace**. Ini berdasarkan UUID, bukan undangan email otomatis.

> `dist/config.js` berisi URL dan anon/public key yang dirancang untuk dipakai di browser. RLS dan Storage policy adalah batas keamanan. Jangan pernah menaruh secret/service-role key dalam `config.js`, environment frontend, atau ZIP publik.

## Data lokal dan migrasi

- Key arsip lokal: `spk_generator_data_v3`.
- Key logo lokal: `spk_generator_logos_v1`.
- Draft aktif dipulihkan melalui IndexedDB dan dipisahkan berdasarkan akun serta workspace. Draft belum dibagikan ke anggota lain sampai SPK disimpan ke arsip cloud.
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
- Cache cloud dibatasi ke workspace dan sesi aktif; pergantian akun membersihkan cache tampilan sebelumnya. Penyimpanan yang dimulai pada akun/workspace lama dihentikan jika konteks berubah.
- Workspace yang dipilih disimpan per akun. Perubahan keanggotaan dapat dimuat ulang dari tombol **Muat ulang workspace** tanpa harus keluar dari sesi.
- Jika dua pengguna mengubah record yang sama dengan versi berbeda, save ditolak dan memberi pesan konflik; aplikasi tidak menimpa perubahan secara diam-diam. Buka kembali versi yang sudah dimuat ulang sebelum melanjutkan.
- Role admin tidak ditentukan di frontend. Pembuatan workspace pertama memberi admin kepada pembuat; penambahan/perubahan anggota hanya melalui RPC admin yang memeriksa role.
- Login publik tersedia karena layar menyediakan tombol Buat akun. Pengguna baru tidak dapat membaca workspace yang sudah ada; ia hanya menjadi anggota setelah admin menambahkan UUID-nya.
- Versi logo baru diunggah ke path berbeda; snapshot SPK tetap menunjuk versi lama. File versi lama dipertahankan untuk menjaga dokumen historis.

## Keterbatasan yang belum diverifikasi

- Akses DB aktif menunjukkan satu keanggotaan aktif; akun kedua belum tersedia sebagai anggota untuk uji baca lintas akun nyata. Alur dua akun diuji dengan backend tiruan. Admin harus menambahkan UUID akun kedua agar data terlihat di akun tersebut.
- Uji login dua akun nyata, upload Storage baru, pemulihan database, dan pemulihan Storage belum dilakukan.
- Arsip cloud dimuat bertahap dengan pagination 500 record per halaman. Alur formulir saat ini menyimpan satu gambar desain utama per SPK; dukungan beberapa gambar per SPK belum diimplementasikan.
- Ekspor PDF menggunakan dialog cetak browser dan pengguna memilih “Save as PDF”; ini bukan pembangkitan PDF langsung di aplikasi.
- Admin menambahkan akun yang sudah terdaftar berdasarkan UUID. Pengiriman invite email otomatis melalui Auth Admin API/Edge Function belum dibuat.
- Backup database terjadwal dan pemulihan Storage otomatis bergantung pada layanan/paket yang dipilih serta masih harus dikonfigurasi dan dites.

## Hasil pemeriksaan pada paket ini

- Build menghasilkan `dist/` yang hanya berisi aset frontend dan `config.js`; berkas migration dan dokumentasi pengembangan tidak disertakan ke output publik.
- `node --check` pada `script.js`, `cloud.js`, dan `config.js` — lulus.
- Pemeriksaan statis dan regression test alur sesi, pergantian akun, keanggotaan workspace, cache, draft, dan kontrol konflik — lulus lewat `npm run check`.
- `npm run build` dengan URL dan publishable key Supabase — lulus; aset produksi memuat konfigurasi publik saja.
- Project DB, RLS, RPC, policy Storage, dan log 24 jam telah diperiksa langsung. Tidak ada error save/storage relevan di log; pemeriksaan dua akun memakai backend tiruan karena database hanya memiliki satu anggota aktif.



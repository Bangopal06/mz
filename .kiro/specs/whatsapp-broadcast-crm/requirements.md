# Dokumen Requirements

## Pendahuluan

Aplikasi WhatsApp Broadcast CRM adalah platform manajemen komunikasi berbasis web yang memungkinkan admin untuk mengelola kontak, mengirim pesan broadcast ke banyak penerima sekaligus melalui WhatsApp, serta memantau performa komunikasi melalui dashboard analitik. Sistem ini dirancang menyerupai CRM komunikasi dengan integrasi WhatsApp Web API (misalnya via Baileys atau WPPConnect), mendukung multi pengguna dengan role berbeda, konten media, dan fitur auto reply berbasis keyword.

## Glosarium

- **System**: Aplikasi WhatsApp Broadcast CRM secara keseluruhan
- **User**: Pengguna yang terdaftar dalam sistem dengan role tertentu
- **Owner**: Pengguna dengan akses penuh ke seluruh fitur dan manajemen akun
- **Admin**: Pengguna dengan akses operasional penuh (kecuali manajemen role dan akun pengguna lain)
- **Staff**: Pengguna dengan akses terbatas hanya untuk mengirim pesan
- **Operator**: Pengguna dengan akses hanya untuk melihat data kontak
- **Contact**: Entitas data yang merepresentasikan satu nomor WhatsApp beserta informasi terkaitnya
- **Contact_Group**: Kumpulan kontak yang dikelompokkan berdasarkan kategori atau label tertentu
- **Broadcast**: Fitur pengiriman pesan ke banyak kontak sekaligus
- **Broadcast_Job**: Satu sesi pengiriman broadcast yang memiliki status, jadwal, dan daftar penerima
- **Message_Template**: Template pesan yang dapat digunakan kembali untuk broadcast
- **Media_Attachment**: Konten media yang dilampirkan dalam pesan (foto, video, PDF, dokumen)
- **Auto_Reply**: Fitur balasan otomatis yang dipicu oleh keyword tertentu dari kontak
- **Keyword_Rule**: Aturan yang mendefinisikan keyword pemicu dan respons Auto_Reply yang sesuai
- **WhatsApp_Session**: Sesi koneksi WhatsApp yang aktif melalui QR code pairing
- **Dashboard**: Halaman ringkasan analitik dan status sistem
- **Contact_Import**: Proses mengunggah daftar kontak dari file eksternal
- **Delivery_Status**: Status pengiriman pesan (terkirim, gagal, pending, dibaca)
- **Rate_Limiter**: Komponen yang mengatur kecepatan pengiriman pesan agar tidak diblokir WhatsApp
- **Permission_Matrix**: Tabel definisi hak akses setiap role terhadap fitur-fitur sistem

---

## Requirements

### Requirement 1: Dashboard Admin

**User Story:** Sebagai User, saya ingin melihat ringkasan statistik sistem di satu halaman, agar saya dapat memantau kondisi sistem secara cepat tanpa harus membuka banyak halaman.

#### Acceptance Criteria

1. THE Dashboard SHALL menampilkan total jumlah kontak yang tersimpan dalam sistem.
2. THE Dashboard SHALL menampilkan jumlah pesan yang berhasil terkirim dalam periode hari ini.
3. THE Dashboard SHALL menampilkan jumlah pesan yang gagal terkirim dalam periode hari ini.
4. THE Dashboard SHALL menampilkan status koneksi WhatsApp_Session saat ini (terhubung atau terputus).
5. THE Dashboard SHALL menampilkan jumlah Broadcast_Job yang sedang berjalan saat ini.
6. WHEN User membuka Dashboard, THE Dashboard SHALL memuat semua data ringkasan dalam waktu kurang dari 3 detik.
7. WHEN status WhatsApp_Session berubah, THE Dashboard SHALL memperbarui indikator status secara otomatis tanpa perlu reload halaman.
8. THE Dashboard SHALL menampilkan grafik tren pengiriman pesan dalam 7 hari terakhir.

---

### Requirement 2: Manajemen Kontak

**User Story:** Sebagai Admin, saya ingin mengelola daftar kontak WhatsApp, agar saya dapat mengorganisasi penerima pesan dengan terstruktur.

#### Acceptance Criteria

1. THE System SHALL menyimpan setiap Contact dengan atribut: nama, nomor WhatsApp, kategori, status (aktif/nonaktif), dan tanggal masuk.
2. WHEN Admin menambahkan Contact baru, THE System SHALL memvalidasi format nomor WhatsApp (format internasional, contoh: 628xxxxxxxxxx).
3. IF nomor WhatsApp yang dimasukkan sudah terdaftar, THEN THE System SHALL menampilkan pesan error duplikasi dan menolak penyimpanan.
4. WHEN Admin memperbarui data Contact, THE System SHALL menyimpan perubahan dan memperbarui tampilan daftar kontak.
5. WHEN Admin menghapus Contact, THE System SHALL meminta konfirmasi sebelum menghapus data secara permanen.
6. THE System SHALL mendukung pencarian Contact berdasarkan nama atau nomor WhatsApp.
7. THE System SHALL mendukung filter Contact berdasarkan Contact_Group, kategori, atau status.
8. THE System SHALL menampilkan daftar Contact dengan paginasi, menampilkan maksimal 50 kontak per halaman.

---

### Requirement 3: Manajemen Grup Kontak

**User Story:** Sebagai Admin, saya ingin mengelompokkan kontak ke dalam grup, agar saya dapat mengirim broadcast ke segmen kontak tertentu dengan mudah.

#### Acceptance Criteria

1. THE System SHALL memungkinkan Admin membuat Contact_Group dengan nama dan deskripsi.
2. WHEN Admin menambahkan Contact ke Contact_Group, THE System SHALL memperbarui asosiasi kontak dengan grup tersebut.
3. THE System SHALL mendukung satu Contact untuk terdaftar di lebih dari satu Contact_Group.
4. WHEN Admin menghapus Contact_Group, THE System SHALL menghapus grup tanpa menghapus Contact yang berada di dalamnya.
5. THE System SHALL menampilkan jumlah anggota untuk setiap Contact_Group.

---

### Requirement 4: Import Kontak

**User Story:** Sebagai Admin, saya ingin mengimpor daftar kontak dari file CSV atau Excel, agar saya dapat menambahkan banyak kontak sekaligus tanpa input manual satu per satu.

#### Acceptance Criteria

1. THE Contact_Import SHALL mendukung format file CSV dan XLSX.
2. WHEN Admin mengunggah file untuk Contact_Import, THE Contact_Import SHALL memvalidasi struktur kolom yang diperlukan (minimal: nama, nomor WhatsApp).
3. IF file Contact_Import mengandung baris dengan format nomor tidak valid, THEN THE Contact_Import SHALL melaporkan baris yang bermasalah dan melanjutkan impor untuk baris yang valid.
4. WHEN Contact_Import selesai, THE System SHALL menampilkan ringkasan: jumlah kontak berhasil diimpor, jumlah dilewati karena duplikat, dan jumlah baris gagal.
5. THE Contact_Import SHALL mendukung penugasan kontak yang diimpor ke Contact_Group tertentu saat proses impor.

---

### Requirement 5: Template Pesan

**User Story:** Sebagai Admin, saya ingin membuat dan mengelola template pesan, agar saya dapat menggunakan ulang pesan yang sering dikirim tanpa mengetik ulang.

#### Acceptance Criteria

1. THE System SHALL memungkinkan Admin membuat Message_Template dengan judul dan isi pesan.
2. THE Message_Template SHALL mendukung variabel personalisasi dengan format `{{nama}}`, `{{nomor}}`, dan variabel kustom lainnya.
3. WHEN Admin menyimpan Message_Template, THE System SHALL memvalidasi bahwa isi pesan tidak kosong.
4. THE System SHALL menampilkan pratinjau Message_Template dengan data kontak contoh sebelum digunakan untuk broadcast.
5. WHEN Admin menghapus Message_Template, THE System SHALL meminta konfirmasi jika template sedang digunakan oleh Broadcast_Job yang terjadwal.

---

### Requirement 6: Broadcast Pesan

**User Story:** Sebagai Admin, saya ingin mengirim pesan broadcast ke banyak kontak sekaligus, agar saya dapat menjangkau banyak orang dengan efisien.

#### Acceptance Criteria

1. WHEN Admin membuat Broadcast_Job baru, THE System SHALL menyediakan tiga pilihan seleksi penerima melalui checkbox: semua kontak, Contact_Group tertentu, atau pemilihan kontak secara manual satu per satu.
2. WHEN Admin memilih Contact_Group tertentu sebagai penerima, THE System SHALL menampilkan daftar Contact_Group yang tersedia beserta jumlah anggota masing-masing untuk dipilih melalui checkbox.
3. WHEN Admin memilih penerima secara manual, THE System SHALL menampilkan daftar Contact yang dapat dipilih satu per satu melalui checkbox dengan dukungan pencarian.
4. THE Broadcast_Job SHALL mendukung pengiriman langsung (immediate) dan pengiriman terjadwal pada waktu yang ditentukan.
5. WHILE Broadcast_Job sedang berjalan, THE Rate_Limiter SHALL membatasi kecepatan pengiriman dengan jeda minimal 3 hingga 10 detik antar pesan untuk menghindari pemblokiran akun.
6. WHEN Broadcast_Job selesai, THE System SHALL mencatat Delivery_Status untuk setiap kontak penerima.
7. THE System SHALL mendukung personalisasi pesan menggunakan variabel dari data Contact (nama, nomor) saat mengirim Broadcast_Job.
8. IF WhatsApp_Session terputus saat Broadcast_Job sedang berjalan, THEN THE System SHALL menghentikan pengiriman dan menyimpan posisi terakhir agar dapat dilanjutkan.
9. WHILE Broadcast_Job sedang berjalan, THE Dashboard SHALL menampilkan progress pengiriman secara real-time (jumlah terkirim, gagal, dan tersisa).
10. THE System SHALL mendukung pembatalan Broadcast_Job yang sedang berjalan atau yang terjadwal.

---

### Requirement 7: Riwayat dan Laporan Broadcast

**User Story:** Sebagai Admin, saya ingin melihat riwayat dan hasil setiap broadcast, agar saya dapat mengevaluasi efektivitas komunikasi.

#### Acceptance Criteria

1. THE System SHALL menyimpan riwayat setiap Broadcast_Job beserta Delivery_Status per penerima.
2. WHEN Admin membuka detail Broadcast_Job, THE System SHALL menampilkan daftar penerima beserta status masing-masing: terkirim, gagal, atau pending.
3. THE System SHALL menampilkan ringkasan statistik per Broadcast_Job: persentase keberhasilan, jumlah terkirim, dan jumlah gagal.
4. THE System SHALL mendukung filter riwayat Broadcast_Job berdasarkan rentang tanggal.
5. THE System SHALL mendukung ekspor laporan Broadcast_Job ke format CSV.

---

### Requirement 8: Integrasi WhatsApp Session

**User Story:** Sebagai Admin, saya ingin menghubungkan akun WhatsApp ke sistem melalui QR code, agar sistem dapat mengirim pesan atas nama akun saya.

#### Acceptance Criteria

1. WHEN Admin memulai koneksi WhatsApp, THE System SHALL menampilkan QR code yang harus dipindai menggunakan aplikasi WhatsApp di ponsel.
2. WHEN QR code berhasil dipindai, THE System SHALL menyimpan sesi WhatsApp_Session secara persisten sehingga tidak perlu scan ulang setelah server restart.
3. WHEN WhatsApp_Session terputus, THE System SHALL mengirimkan notifikasi kepada User yang berwenang melalui tampilan antarmuka.
4. THE System SHALL mendukung reconnect otomatis ketika WhatsApp_Session terputus karena gangguan jaringan sementara.
5. IF sesi WhatsApp_Session tidak aktif lebih dari 30 hari tanpa aktivitas, THEN THE System SHALL menandai sesi sebagai kedaluwarsa dan meminta Admin untuk scan ulang QR code.
6. THE System SHALL mendukung lebih dari satu WhatsApp_Session yang aktif secara bersamaan untuk akun WhatsApp yang berbeda.

---

### Requirement 9: Keamanan dan Autentikasi Multi-User

**User Story:** Sebagai Owner, saya ingin sistem mendukung banyak pengguna dengan level akses berbeda, agar setiap anggota tim hanya dapat mengakses fitur yang sesuai dengan peran mereka.

#### Acceptance Criteria

1. THE System SHALL mengharuskan setiap User untuk login menggunakan email dan password sebelum mengakses fitur apapun.
2. WHEN User gagal login sebanyak 5 kali berturut-turut, THE System SHALL mengunci akun selama 15 menit.
3. THE System SHALL menggunakan sesi autentikasi berbasis token dengan masa berlaku 8 jam.
4. WHEN sesi autentikasi berakhir, THE System SHALL mengarahkan User kembali ke halaman login.
5. THE System SHALL menyimpan password User dalam bentuk hash menggunakan algoritma bcrypt.
6. THE System SHALL menerapkan Permission_Matrix berdasarkan role berikut:
   - Owner: akses penuh ke seluruh fitur termasuk manajemen User dan role
   - Admin: akses ke seluruh fitur operasional kecuali manajemen role dan akun User lain
   - Staff: akses hanya untuk membuat dan mengirim Broadcast_Job
   - Operator: akses hanya untuk melihat data Contact
7. WHEN User dengan role Staff atau Operator mencoba mengakses fitur di luar Permission_Matrix, THE System SHALL menampilkan pesan akses ditolak dan tidak memproses permintaan.
8. THE System SHALL memungkinkan Owner untuk membuat, menonaktifkan, dan menghapus akun User lain.

---

### Requirement 10: Notifikasi dan Log Aktivitas

**User Story:** Sebagai Admin, saya ingin melihat log aktivitas sistem, agar saya dapat melacak semua aksi yang terjadi dan mendiagnosis masalah.

#### Acceptance Criteria

1. THE System SHALL mencatat setiap aksi penting ke dalam log aktivitas: login, pembuatan broadcast, perubahan kontak, perubahan role User, dan perubahan status koneksi.
2. THE System SHALL menampilkan log aktivitas dalam antarmuka admin dengan informasi: waktu, jenis aksi, User yang melakukan aksi, dan detail aksi.
3. THE System SHALL menyimpan log aktivitas selama minimal 90 hari.
4. WHEN terjadi error pengiriman pesan, THE System SHALL mencatat detail error (kode error, nomor tujuan, dan waktu kejadian) ke dalam log.

---

### Requirement 11: Dukungan Media dalam Pesan

**User Story:** Sebagai Admin, saya ingin mengirim pesan yang mengandung media seperti foto, video, atau dokumen, agar komunikasi dengan kontak dapat lebih informatif dan menarik.

#### Acceptance Criteria

1. THE System SHALL mendukung penambahan Media_Attachment pada pesan broadcast dengan tipe: foto (JPEG, PNG), video (MP4), PDF, dan dokumen (DOCX, XLSX).
2. WHEN Admin mengunggah Media_Attachment, THE System SHALL memvalidasi ukuran file tidak melebihi 16 MB sesuai batas WhatsApp.
3. WHEN Admin mengunggah Media_Attachment dengan format tidak didukung, THE System SHALL menampilkan pesan error dan menolak file tersebut.
4. THE System SHALL mendukung penambahan caption teks pada setiap Media_Attachment yang diunggah.
5. THE Message_Template SHALL mendukung penyertaan satu Media_Attachment beserta caption opsional.
6. THE System SHALL mendukung penyertaan URL atau tautan dalam isi pesan teks.
7. WHEN Broadcast_Job dengan Media_Attachment dikirim, THE System SHALL mengirimkan media beserta caption ke setiap penerima dalam urutan yang sama.
8. THE System SHALL menampilkan pratinjau Media_Attachment sebelum Broadcast_Job dikirim.

---

### Requirement 12: Auto Reply Berbasis Keyword

**User Story:** Sebagai Admin, saya ingin sistem membalas pesan masuk dari kontak secara otomatis berdasarkan keyword tertentu, agar pertanyaan umum dapat ditangani tanpa intervensi manual.

#### Acceptance Criteria

1. THE System SHALL memungkinkan Admin membuat Keyword_Rule yang terdiri dari: kata kunci pemicu (tidak peka huruf besar/kecil) dan teks respons otomatis.
2. WHEN kontak mengirimkan pesan yang mengandung kata kunci yang cocok dengan Keyword_Rule aktif, THE Auto_Reply SHALL mengirimkan respons yang telah dikonfigurasi dalam waktu kurang dari 5 detik.
3. THE System SHALL mendukung satu Keyword_Rule untuk memiliki lebih dari satu kata kunci alternatif sebagai pemicu.
4. THE System SHALL mendukung respons Auto_Reply yang mengandung teks menu pilihan berformat penomoran.
5. WHEN Admin menonaktifkan Keyword_Rule, THE Auto_Reply SHALL berhenti merespons kata kunci tersebut tanpa menghapus konfigurasi.
6. IF pesan masuk dari kontak tidak cocok dengan Keyword_Rule manapun yang aktif, THEN THE Auto_Reply SHALL tidak mengirimkan respons apapun.
7. THE System SHALL mencatat setiap respons Auto_Reply yang dikirimkan ke dalam log aktivitas beserta kata kunci yang memicunya.
8. THE System SHALL mendukung pengaturan pesan sambutan (greeting) yang dikirim satu kali kepada kontak yang pertama kali mengirim pesan.

---

### Requirement 13: Manajemen Multi Admin dan Role

**User Story:** Sebagai Owner, saya ingin mengelola akun pengguna dalam tim dengan role yang berbeda, agar setiap anggota memiliki akses yang sesuai dengan tanggung jawabnya.

#### Acceptance Criteria

1. THE System SHALL mendukung pembuatan akun User dengan empat role yang tersedia: Owner, Admin, Staff, dan Operator.
2. WHEN Owner membuat akun User baru, THE System SHALL mengirimkan kredensial login awal melalui email yang didaftarkan.
3. THE System SHALL menampilkan daftar seluruh User yang terdaftar beserta role dan status aktif/nonaktif masing-masing.
4. WHEN Owner mengubah role User, THE System SHALL menerapkan Permission_Matrix baru segera setelah perubahan disimpan, termasuk mengakhiri sesi aktif User tersebut.
5. THE System SHALL memastikan terdapat minimal satu akun dengan role Owner yang aktif dalam sistem setiap saat.
6. IF Owner mencoba menghapus atau menonaktifkan satu-satunya akun Owner yang tersisa, THEN THE System SHALL menolak permintaan tersebut dan menampilkan pesan bahwa minimal satu Owner harus tetap aktif.
7. THE System SHALL menampilkan Permission_Matrix dalam antarmuka manajemen User yang memperlihatkan hak akses setiap role terhadap fitur-fitur sistem.
8. WHEN Owner menonaktifkan akun User, THE System SHALL mengakhiri semua sesi aktif User tersebut dan mencegah login baru.

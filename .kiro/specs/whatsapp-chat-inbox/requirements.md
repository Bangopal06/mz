# Dokumen Requirements

## Pendahuluan

Fitur WhatsApp Chat Inbox adalah halaman percakapan dua arah di dalam CRM yang tampilannya menyerupai WhatsApp. Pengguna dapat melihat daftar percakapan per kontak di panel kiri, membuka riwayat chat di panel kanan, mengirim pesan teks dan gambar, serta menerima pesan masuk secara real-time tanpa refresh halaman. Fitur ini mendukung multi sesi WhatsApp, sehingga pengguna dapat memilih dari sesi mana pesan dikirim.

Sistem terdiri dari tiga komponen utama: **Gateway** (Node.js + Baileys) yang menjembatani WhatsApp, **Backend** (Next.js API Routes) sebagai lapisan API, dan **Frontend** (Next.js App Router) sebagai antarmuka pengguna. Penyimpanan data menggunakan Supabase PostgreSQL, distribusi real-time menggunakan Supabase Realtime, dan file media menggunakan Supabase Storage.

## Glosarium

- **System**: Aplikasi WhatsApp Broadcast CRM secara keseluruhan
- **Chat_Page**: Halaman `/chat` dalam aplikasi CRM yang menampilkan inbox dan area percakapan
- **Inbox_Panel**: Panel kiri pada Chat_Page yang menampilkan daftar percakapan per kontak
- **Chat_Panel**: Panel kanan pada Chat_Page yang menampilkan riwayat pesan untuk satu kontak
- **Conversation**: Kumpulan pesan antara sistem dan satu nomor WhatsApp tertentu dalam konteks satu sesi
- **Message**: Satu unit pesan teks atau media yang dikirim atau diterima
- **Gateway**: Layanan Node.js yang menggunakan Baileys untuk terhubung ke WhatsApp
- **WA_Session**: Sesi koneksi WhatsApp yang aktif, tersimpan di tabel `wa_sessions`
- **Contact**: Entitas kontak yang tersimpan di tabel `contacts`
- **Supabase_Realtime**: Mekanisme push notification berbasis WebSocket dari Supabase untuk perubahan database
- **Media_Message**: Pesan yang mengandung lampiran gambar (JPEG atau PNG)
- **User**: Pengguna CRM yang sedang login

---

## Requirements

### Requirement 1: Penyimpanan Pesan di Database

**User Story:** Sebagai sistem, saya ingin semua pesan masuk dan keluar disimpan ke database, agar riwayat percakapan dapat ditampilkan dan dianalisis.

#### Acceptance Criteria

1. THE System SHALL menyimpan setiap pesan dengan atribut: `id`, `wa_session_id`, `contact_wa_number`, `direction` (inbound/outbound), `message_type` (text/image), `body` (teks pesan), `media_url` (URL media jika ada), `wa_message_id` (ID pesan dari WhatsApp), `status` (sent/delivered/read/failed/received), dan `created_at`.
2. THE System SHALL membuat indeks pada kolom `(wa_session_id, contact_wa_number, created_at)` untuk mendukung query riwayat percakapan secara efisien.
3. THE System SHALL membuat indeks pada kolom `contact_wa_number` untuk mendukung query daftar percakapan unik secara efisien.
4. IF `wa_message_id` yang sama sudah tersimpan untuk `wa_session_id` yang sama, THEN THE System SHALL mengabaikan penyimpanan duplikat tanpa menghasilkan error.
5. THE System SHALL menyimpan `contact_wa_number` dalam format internasional (contoh: `628xxxxxxxxxx`) secara konsisten.

---

### Requirement 2: Gateway Menyimpan Pesan Masuk

**User Story:** Sebagai sistem, saya ingin Gateway menyimpan setiap pesan masuk dari WhatsApp ke database, agar pesan tidak hilang dan dapat ditampilkan di inbox.

#### Acceptance Criteria

1. WHEN Gateway menerima event `messages.upsert` dari Baileys, THE Gateway SHALL menyimpan pesan ke tabel `chat_messages` di Supabase sebelum memproses auto-reply.
2. WHEN pesan masuk berhasil disimpan, THE Gateway SHALL memicu Supabase_Realtime secara otomatis melalui mekanisme database change (INSERT event pada tabel `chat_messages`).
3. IF penyimpanan pesan ke database gagal, THEN THE Gateway SHALL mencatat error ke log tetapi tetap melanjutkan proses auto-reply agar tidak terganggu.
4. THE Gateway SHALL menyimpan pesan teks dengan `message_type = 'text'` dan mengisi kolom `body` dengan isi teks pesan.
5. WHEN Gateway menerima pesan gambar dari WhatsApp, THE Gateway SHALL mengunduh media tersebut, mengunggahnya ke Supabase Storage, lalu menyimpan pesan dengan `message_type = 'image'` dan `media_url` berisi URL publik dari Supabase Storage.
6. THE Gateway SHALL menetapkan `direction = 'inbound'` dan `status = 'received'` untuk semua pesan yang berasal dari event `messages.upsert`.

---

### Requirement 3: Halaman Chat — Layout dan Navigasi

**User Story:** Sebagai User, saya ingin membuka halaman chat yang tampilannya familiar seperti WhatsApp, agar saya dapat langsung memahami cara penggunaannya.

#### Acceptance Criteria

1. THE Chat_Page SHALL menampilkan dua panel secara berdampingan: Inbox_Panel di sebelah kiri dan Chat_Panel di sebelah kanan.
2. THE Inbox_Panel SHALL memiliki lebar tetap dan menampilkan daftar percakapan yang dapat di-scroll secara vertikal.
3. THE Chat_Panel SHALL mengisi sisa lebar halaman dan menampilkan pesan dalam bentuk gelembung (bubble) percakapan.
4. WHEN Chat_Page pertama kali dibuka, THE Chat_Panel SHALL menampilkan state kosong dengan petunjuk untuk memilih percakapan dari Inbox_Panel.
5. THE Chat_Page SHALL dapat diakses melalui navigasi utama aplikasi di URL `/chat`.
6. WHILE pengguna berada di Chat_Page pada viewport mobile (lebar < 768px), THE Chat_Page SHALL menampilkan Inbox_Panel atau Chat_Panel secara bergantian (tidak berdampingan), dengan tombol kembali untuk beralih ke Inbox_Panel.

---

### Requirement 4: Inbox Panel — Daftar Percakapan

**User Story:** Sebagai User, saya ingin melihat daftar semua percakapan di panel kiri, agar saya dapat dengan cepat menemukan dan membuka percakapan yang diinginkan.

#### Acceptance Criteria

1. THE Inbox_Panel SHALL menampilkan satu entri per kontak unik (`contact_wa_number`) berdasarkan pesan terbaru, diurutkan dari percakapan dengan pesan paling baru di posisi paling atas.
2. WHEN Inbox_Panel memuat daftar percakapan, THE Inbox_Panel SHALL menampilkan untuk setiap entri: nama kontak (dari tabel `contacts`) atau nomor WhatsApp jika kontak tidak ditemukan, pratinjau pesan terakhir (maksimal 40 karakter), dan waktu pesan terakhir.
3. WHEN pesan terakhir adalah Media_Message, THE Inbox_Panel SHALL menampilkan ikon kamera dan teks "Gambar" sebagai pratinjau pesan.
4. WHEN User mengklik satu entri di Inbox_Panel, THE Chat_Panel SHALL memuat riwayat percakapan dengan kontak tersebut.
5. THE Inbox_Panel SHALL menampilkan entri percakapan yang sedang aktif dengan latar belakang yang berbeda sebagai indikator visual.
6. THE Inbox_Panel SHALL mendukung pencarian percakapan berdasarkan nama kontak atau nomor WhatsApp melalui input pencarian di bagian atas panel.
7. WHEN hasil pencarian tidak menemukan percakapan yang cocok, THE Inbox_Panel SHALL menampilkan pesan "Tidak ada percakapan ditemukan".

---

### Requirement 5: Chat Panel — Riwayat Pesan

**User Story:** Sebagai User, saya ingin melihat riwayat pesan lengkap dengan satu kontak di panel kanan, agar saya dapat memahami konteks percakapan sebelum membalas.

#### Acceptance Criteria

1. WHEN User membuka percakapan, THE Chat_Panel SHALL memuat dan menampilkan pesan-pesan dalam urutan kronologis (pesan lama di atas, pesan baru di bawah).
2. THE Chat_Panel SHALL membedakan secara visual pesan masuk (inbound) di sisi kiri bubble dengan warna berbeda dari pesan keluar (outbound) di sisi kanan bubble.
3. THE Chat_Panel SHALL menampilkan waktu pengiriman di bawah setiap bubble pesan dalam format yang mudah dibaca (contoh: "13:45" untuk hari ini, "Senin 13:45" untuk hari lain).
4. WHEN pesan bertipe image, THE Chat_Panel SHALL menampilkan thumbnail gambar di dalam bubble. WHEN User mengklik thumbnail tersebut, THE Chat_Panel SHALL membuka gambar dalam tampilan penuh (lightbox).
5. THE Chat_Panel SHALL memuat 50 pesan terbaru pertama kali. WHEN User melakukan scroll ke bagian atas, THE Chat_Panel SHALL memuat 50 pesan berikutnya (infinite scroll ke atas / pagination).
6. WHEN Chat_Panel selesai memuat pesan, THE Chat_Panel SHALL otomatis scroll ke posisi pesan paling bawah (pesan terbaru).
7. THE Chat_Panel SHALL menampilkan nama kontak dan nomor WhatsApp di bagian header panel.
8. WHEN status pesan outbound berubah menjadi `delivered` atau `read`, THE Chat_Panel SHALL memperbarui indikator status di bubble pesan yang bersangkutan.

---

### Requirement 6: Kirim Pesan Teks

**User Story:** Sebagai User, saya ingin mengirim pesan teks ke kontak langsung dari Chat_Panel, agar saya dapat berkomunikasi tanpa meninggalkan halaman CRM.

#### Acceptance Criteria

1. THE Chat_Panel SHALL menampilkan input area teks dan tombol kirim di bagian bawah panel ketika sebuah percakapan sedang aktif.
2. WHEN User menekan tombol kirim atau menekan Enter pada keyboard, THE System SHALL mengirimkan pesan teks ke Gateway melalui Next.js API Route.
3. THE Next.js API Route SHALL meneruskan permintaan pengiriman pesan ke endpoint `POST /send` pada Gateway dengan payload yang mencakup `sessionId`, `to` (nomor tujuan), dan `text`.
4. WHEN Gateway berhasil mengirimkan pesan ke WhatsApp, THE System SHALL menyimpan pesan ke tabel `chat_messages` dengan `direction = 'outbound'` dan `status = 'sent'`.
5. IF Gateway mengembalikan error saat pengiriman, THEN THE System SHALL menyimpan pesan dengan `status = 'failed'` dan menampilkan indikator gagal pada bubble pesan.
6. WHEN pesan berhasil dikirim, THE Chat_Panel SHALL menampilkan bubble pesan baru di bagian bawah area percakapan dan mengosongkan input area teks.
7. THE Chat_Panel SHALL menonaktifkan tombol kirim dan input teks ketika tidak ada WA_Session yang aktif, dan menampilkan pesan peringatan bahwa tidak ada sesi yang terhubung.
8. THE System SHALL memungkinkan User memilih WA_Session yang akan digunakan untuk mengirim pesan melalui dropdown pemilihan sesi di header Chat_Panel.

---

### Requirement 7: Kirim Pesan Gambar

**User Story:** Sebagai User, saya ingin mengirim gambar ke kontak, agar komunikasi dapat lebih ekspresif dan informatif.

#### Acceptance Criteria

1. THE Chat_Panel SHALL menampilkan tombol lampiran (ikon klip) di samping input teks untuk memilih file gambar.
2. WHEN User memilih file melalui tombol lampiran, THE System SHALL memvalidasi bahwa tipe file adalah JPEG atau PNG dan ukuran file tidak melebihi 5 MB.
3. IF file yang dipilih tidak memenuhi validasi, THEN THE System SHALL menampilkan pesan error yang menjelaskan alasan penolakan dan tidak memproses file tersebut.
4. WHEN file gambar valid dipilih, THE Chat_Panel SHALL menampilkan pratinjau thumbnail gambar di atas input teks sebelum dikirim, beserta tombol untuk membatalkan lampiran.
5. WHEN User mengirim pesan dengan gambar, THE System SHALL mengunggah gambar ke Supabase Storage terlebih dahulu, kemudian mengirimkan URL gambar beserta caption (opsional) ke Gateway melalui Next.js API Route.
6. THE Next.js API Route SHALL meneruskan permintaan ke endpoint `POST /send` pada Gateway dengan payload yang mencakup `sessionId`, `to`, `imageUrl`, dan `caption` opsional.
7. WHEN pengiriman gambar berhasil, THE System SHALL menyimpan pesan ke tabel `chat_messages` dengan `message_type = 'image'` dan `media_url` berisi URL gambar.

---

### Requirement 8: Update Real-Time via Supabase Realtime

**User Story:** Sebagai User, saya ingin pesan masuk baru langsung muncul di layar tanpa perlu me-refresh halaman, agar saya tidak melewatkan pesan dari kontak.

#### Acceptance Criteria

1. WHEN Chat_Page dibuka, THE System SHALL membuat subscription Supabase_Realtime pada tabel `chat_messages` untuk event INSERT.
2. WHEN pesan baru masuk (INSERT event diterima dari Supabase_Realtime), THE Chat_Panel SHALL menampilkan bubble pesan baru secara otomatis jika percakapan dengan kontak tersebut sedang aktif di Chat_Panel.
3. WHEN pesan baru masuk untuk kontak yang berbeda dari yang sedang aktif, THE Inbox_Panel SHALL memindahkan entri kontak tersebut ke posisi paling atas dan memperbarui pratinjau pesan terakhir.
4. WHEN Chat_Page ditutup atau User berpindah halaman, THE System SHALL menutup subscription Supabase_Realtime untuk mencegah memory leak.
5. IF koneksi Supabase_Realtime terputus, THEN THE System SHALL mencoba reconnect secara otomatis dan menampilkan indikator status koneksi kepada User.

---

### Requirement 9: Dukungan Multi Sesi WhatsApp

**User Story:** Sebagai User, saya ingin memilih dari sesi WhatsApp mana pesan dikirimkan, agar saya dapat mengelola komunikasi dari beberapa nomor WhatsApp dalam satu antarmuka.

#### Acceptance Criteria

1. THE Chat_Panel SHALL menampilkan dropdown pemilihan WA_Session yang memuat semua sesi dengan status `connected` dari tabel `wa_sessions`.
2. WHEN hanya ada satu WA_Session aktif, THE System SHALL secara otomatis memilih sesi tersebut tanpa memerlukan tindakan dari User.
3. WHEN User memilih WA_Session berbeda dari dropdown, THE Inbox_Panel SHALL memfilter daftar percakapan untuk hanya menampilkan percakapan yang terkait dengan sesi tersebut.
4. IF tidak ada WA_Session dengan status `connected`, THEN THE System SHALL menampilkan pesan peringatan dan menonaktifkan kemampuan pengiriman pesan.
5. THE Inbox_Panel SHALL menampilkan semua percakapan dari semua sesi secara default jika tidak ada filter sesi yang dipilih.

---

### Requirement 10: Keamanan dan Otorisasi Akses Chat

**User Story:** Sebagai Admin, saya ingin memastikan hanya pengguna yang berwenang yang dapat mengakses dan mengirim pesan dari halaman chat, agar komunikasi dengan kontak tetap terkontrol.

#### Acceptance Criteria

1. THE System SHALL memerlukan User yang terautentikasi (sesi Supabase Auth yang valid) untuk mengakses Chat_Page.
2. WHEN User yang tidak terautentikasi mencoba mengakses URL `/chat`, THE System SHALL mengarahkan User ke halaman login.
3. THE Next.js API Route untuk pengiriman pesan SHALL memvalidasi sesi autentikasi User sebelum meneruskan permintaan ke Gateway.
4. IF permintaan pengiriman pesan tidak menyertakan token autentikasi yang valid, THEN THE System SHALL mengembalikan HTTP status 401 dan menolak permintaan.
5. THE System SHALL menerapkan Row Level Security (RLS) pada tabel `chat_messages` di Supabase sehingga User hanya dapat membaca dan menulis data yang terkait dengan WA_Session yang dimiliki oleh organisasi mereka.


# Rencana Implementasi: WhatsApp Broadcast CRM

## Gambaran Umum

Implementasi dilakukan secara bertahap, dimulai dari fondasi infrastruktur (setup proyek, database, autentikasi), kemudian fitur-fitur inti (kontak, broadcast, template), lalu fitur pendukung (auto reply, media, laporan), dan diakhiri dengan integrasi penuh serta pengujian E2E.

Stack: Next.js 14 (App Router) · Supabase (PostgreSQL + Auth + Edge Functions + Realtime + Storage) · Node.js Gateway (Baileys + BullMQ + Redis) · Vitest + fast-check · Playwright

---

## Tasks

- [x] 1. Setup Proyek dan Struktur Fondasi
  - Inisialisasi monorepo dengan dua workspace: `apps/web` (Next.js 14) dan `apps/gateway` (Node.js)
  - Setup `apps/web`: `npx create-next-app@latest` dengan TypeScript, Tailwind CSS, App Router
  - Setup `apps/gateway`: Node.js + TypeScript + Express/Fastify + BullMQ + Redis
  - Konfigurasi environment variables (`.env.local` untuk web, `.env` untuk gateway) dengan placeholder
  - Install dependency Supabase: `@supabase/supabase-js`, `@supabase/ssr` untuk web
  - Setup Vitest di kedua workspace dengan konfigurasi fast-check
  - Setup Playwright di `apps/web` untuk E2E tests
  - _Requirements: semua_

- [x] 2. Skema Database dan Migrasi Supabase
  - [x] 2.1 Buat migration SQL untuk semua 15 tabel
    - Tabel `users`, `contacts`, `contact_groups`, `contact_group_members`
    - Tabel `media_attachments`, `message_templates`, `wa_sessions`
    - Tabel `broadcast_jobs`, `broadcast_recipients`, `message_logs`
    - Tabel `keyword_rules`, `keyword_triggers`, `greeted_contacts`
    - Tabel `activity_logs`, `failed_login_attempts`
    - Buat semua index yang didefinisikan di design
    - _Requirements: 2.1, 3.1, 5.1, 6.1, 7.1, 8.1, 10.1, 11.1, 12.1_

  - [x] 2.2 Implementasi Row-Level Security (RLS) untuk semua tabel
    - Policy Owner: CRUD penuh semua tabel
    - Policy Admin: CRUD operasional (kecuali `users` management)
    - Policy Staff: CRUD `broadcast_jobs`, Read `contacts`, `message_templates`
    - Policy Operator: Read-only `contacts`
    - Policy untuk `wa_sessions`, `activity_logs`, `keyword_rules` sesuai matriks
    - _Requirements: 9.6, 9.7_

  - [ ]* 2.3 Tulis property test untuk RLS — Property 25
    - **Property 25: Permission Matrix Ditegakkan untuk Semua Role**
    - **Validates: Requirements 9.1, 9.6, 9.7, 9.8**

  - [x] 2.4 Buat Supabase Storage bucket `media-attachments` dengan policy akses
    - Konfigurasi policy: hanya authenticated user yang bisa upload
    - Maksimal ukuran file 16MB dikonfigurasi di bucket policy
    - _Requirements: 11.1, 11.2_

  - [x] 2.5 Setup scheduled Edge Function untuk cleanup activity_logs (retensi 90 hari)
    - Buat `supabase/functions/cleanup-logs/index.ts`
    - Hapus entry dengan `created_at < now() - interval '90 days'`
    - _Requirements: 10.3_

  - [ ]* 2.6 Tulis property test untuk retensi log — Property 30
    - **Property 30: Retensi Log Maksimal 90 Hari**
    - **Validates: Requirements 10.3**

- [x] 3. Autentikasi dan Manajemen User
  - [x] 3.1 Implementasi halaman login (`app/(auth)/login/page.tsx`)
    - Form login email + password dengan validasi client-side
    - Integrasi `supabase.auth.signInWithPassword()`
    - Redirect ke dashboard setelah berhasil login
    - Tampilkan pesan error untuk kredensial salah
    - _Requirements: 9.1, 9.4_

  - [x] 3.2 Implementasi middleware autentikasi Next.js (`middleware.ts`)
    - Cek JWT di setiap request menggunakan `@supabase/ssr`
    - Redirect ke `/login` jika tidak ada sesi atau sesi expired
    - Refresh token secara silent jika hampir expired
    - _Requirements: 9.3, 9.4_

  - [x] 3.3 Implementasi rate limiting login dan penguncian akun
    - Buat Edge Function `supabase/functions/auth-login/index.ts`
    - Catat percobaan gagal ke tabel `failed_login_attempts`
    - Tolak login jika ada ≥ 5 kegagalan dalam 15 menit terakhir
    - Catat event ke `activity_logs` saat login berhasil/gagal
    - _Requirements: 9.2, 10.1_

  - [ ]* 3.4 Tulis property test untuk kunci akun — Property 26
    - **Property 26: Kunci Akun Setelah 5 Kali Gagal Login**
    - **Validates: Requirements 9.2**

  - [ ]* 3.5 Tulis property test untuk JWT expiry — Property 27
    - **Property 27: Token JWT Memiliki Masa Berlaku 8 Jam**
    - **Validates: Requirements 9.3**

  - [ ]* 3.6 Tulis property test untuk password hashing — Property 28
    - **Property 28: Password Tidak Tersimpan sebagai Plaintext**
    - **Validates: Requirements 9.5**

  - [x] 3.7 Implementasi halaman manajemen User (`app/users/`)
    - Daftar semua user dengan role dan status aktif/nonaktif (Owner only)
    - Form buat user baru: email, nama, role — kirim email kredensial awal
    - Aksi ubah role user dengan invalidasi sesi aktif segera
    - Aksi nonaktifkan/aktifkan user + hapus user
    - Guard: tolak jika operasi akan menyisakan 0 Owner aktif
    - Tampilkan Permission Matrix tabel di halaman ini
    - _Requirements: 9.8, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_

  - [ ]* 3.8 Tulis property test untuk minimal satu Owner aktif — Property 37
    - **Property 37: Minimal Satu Owner Aktif Selalu Terpenuhi**
    - **Validates: Requirements 13.5, 13.6**

  - [ ]* 3.9 Tulis property test untuk invalidasi sesi saat role berubah — Property 38
    - **Property 38: Perubahan Role Mengakhiri Sesi Aktif User**
    - **Validates: Requirements 13.4, 13.8**

- [x] 4. Checkpoint — Fondasi dan Auth
  - Pastikan semua migration berhasil dijalankan di Supabase
  - Pastikan login, redirect, dan logout berfungsi
  - Pastikan RLS aktif dan middleware melindungi semua route
  - Pastikan semua tests pass, tanya user jika ada pertanyaan.

- [x] 5. Manajemen Kontak
  - [x] 5.1 Implementasi tipe dan fungsi utilitas kontak
    - Definisikan TypeScript interface `Contact`, `ContactFilter`, `PaginatedResult<T>`
    - Fungsi `validateWaNumber(phone: string): boolean` — format 62xxxxxxxx, 10-15 digit
    - Fungsi `sanitizeWaNumber(phone: string): string` — strip non-digit, pastikan prefix 62
    - _Requirements: 2.1, 2.2_

  - [ ]* 5.2 Tulis property test untuk validasi nomor WA — Property 5
    - **Property 5: Validasi Format Nomor WA**
    - **Validates: Requirements 2.2**

  - [ ]* 5.3 Tulis property test untuk uniqueness nomor WA — Property 6
    - **Property 6: Uniqueness Nomor WA**
    - **Validates: Requirements 2.3**

  - [x] 5.4 Implementasi halaman daftar kontak (`app/contacts/page.tsx`)
    - Tabel dengan kolom: nama, nomor WA, kategori, status, tanggal masuk
    - Paginasi 50 item per halaman dengan navigasi halaman
    - Kolom pencarian (nama atau nomor WA, case-insensitive)
    - Filter dropdown: Contact_Group, kategori, status
    - _Requirements: 2.6, 2.7, 2.8_

  - [ ]* 5.5 Tulis property test untuk paginasi kontak — Property 9
    - **Property 9: Paginasi Tidak Melebihi Batas**
    - **Validates: Requirements 2.8**

  - [ ]* 5.6 Tulis property test untuk pencarian kontak — Property 7
    - **Property 7: Pencarian Kontak Mengembalikan Hasil Relevan**
    - **Validates: Requirements 2.6**

  - [ ]* 5.7 Tulis property test untuk filter kontak — Property 8
    - **Property 8: Filter Kontak Menghasilkan Subset yang Konsisten**
    - **Validates: Requirements 2.7**

  - [x] 5.8 Implementasi form tambah dan edit kontak
    - Modal/page form: nama, nomor WA, kategori, status, catatan
    - Validasi format nomor WA sebelum submit
    - Tampilkan error duplikasi jika nomor sudah terdaftar
    - Konfirmasi sebelum hapus kontak
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 5.9 Tulis property test untuk round-trip data kontak — Property 4
    - **Property 4: Round-Trip Data Kontak**
    - **Validates: Requirements 2.1, 2.4**

- [x] 6. Manajemen Grup Kontak
  - [x] 6.1 Implementasi halaman grup kontak (`app/contacts/groups/`)
    - Daftar grup dengan nama, deskripsi, dan jumlah anggota
    - Form buat grup baru (nama + deskripsi)
    - Form edit grup
    - Konfirmasi hapus grup (tampilkan peringatan kontak tidak ikut terhapus)
    - _Requirements: 3.1, 3.4, 3.5_

  - [x] 6.2 Implementasi manajemen anggota grup
    - Modal tambah kontak ke grup (search + multi-select)
    - Tampilkan daftar anggota per grup
    - Hapus kontak dari grup
    - Dukung satu kontak di banyak grup
    - _Requirements: 3.2, 3.3_

  - [ ]* 6.3 Tulis property test untuk hapus grup — Property 10
    - **Property 10: Hapus Grup Tidak Menghapus Kontak**
    - **Validates: Requirements 3.4**

  - [ ]* 6.4 Tulis property test untuk jumlah anggota grup — Property 11
    - **Property 11: Jumlah Anggota Grup Akurat**
    - **Validates: Requirements 3.5, 6.2**

- [x] 7. Import Kontak (CSV/XLSX)
  - [x] 7.1 Implementasi parser file CSV dan XLSX
    - Gunakan library `papaparse` (CSV) dan `xlsx` (XLSX) di Edge Function
    - Validasi header kolom wajib: `nama`, `nomor` (atau alias yang didukung)
    - Parse setiap baris, validasi format nomor WA per baris
    - Kembalikan array: `{ valid: Contact[], invalid: {row, reason}[], duplicates: string[] }`
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 7.2 Implementasi Edge Function import kontak (`supabase/functions/contacts-import/`)
    - Terima file upload multipart, jalankan parser
    - Upsert baris valid ke tabel `contacts` (skip duplikat, catat yang dilewati)
    - Jika `group_id` dikirim, insert anggota baru ke `contact_group_members`
    - Kembalikan laporan: `{ imported, skipped_duplicates, failed, errors[] }`
    - _Requirements: 4.3, 4.4, 4.5_

  - [x] 7.3 Implementasi halaman import kontak (`app/contacts/import/`)
    - Dropzone upload file (CSV/XLSX), preview kolom yang terdeteksi
    - Pilihan assign ke grup (opsional)
    - Progress bar saat upload dan proses
    - Tampilkan ringkasan hasil import setelah selesai
    - _Requirements: 4.1, 4.2, 4.4, 4.5_

  - [ ]* 7.4 Tulis property test untuk konsistensi laporan import — Property 12
    - **Property 12: Import Partial — Konsistensi Laporan**
    - **Validates: Requirements 4.3, 4.4**

  - [ ]* 7.5 Tulis property test untuk kontak hasil import masuk ke grup — Property 13
    - **Property 13: Kontak Hasil Import Masuk ke Grup Tujuan**
    - **Validates: Requirements 4.5**

- [x] 8. Checkpoint — Kontak dan Grup
  - Pastikan CRUD kontak, grup, dan import berfungsi end-to-end
  - Pastikan validasi nomor WA, paginasi, dan filter berjalan benar
  - Pastikan semua tests pass, tanya user jika ada pertanyaan.

- [x] 9. Template Pesan
  - [x] 9.1 Implementasi fungsi resolve variabel template
    - Fungsi `resolveTemplate(body: string, contact: Contact): string`
    - Ganti `{{nama}}` dengan `contact.full_name`, `{{nomor}}` dengan `contact.wa_number`
    - Dukung variabel kustom dari field tambahan
    - Setelah resolve, pastikan tidak ada pola `{{...}}` yang tersisa
    - _Requirements: 5.2, 6.7_

  - [ ]* 9.2 Tulis property test untuk resolve variabel template — Property 14
    - **Property 14: Variabel Template Harus Ter-resolve Sepenuhnya**
    - **Validates: Requirements 5.2, 6.7**

  - [ ]* 9.3 Tulis property test untuk validasi template kosong — Property 15
    - **Property 15: Validasi Template Kosong**
    - **Validates: Requirements 5.3**

  - [x] 9.4 Implementasi halaman template pesan (`app/templates/`)
    - Daftar template dengan judul dan preview isi
    - Form buat/edit template: judul, isi pesan (dengan syntax highlight `{{variabel}}`)
    - Validasi isi tidak boleh kosong atau hanya whitespace
    - Panel pratinjau dengan data kontak contoh (resolve variabel real-time)
    - Opsi lampirkan media attachment ke template
    - Konfirmasi hapus jika template digunakan oleh broadcast terjadwal
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 11.5_

- [x] 10. Dukungan Media
  - [x] 10.1 Implementasi komponen upload media
    - Komponen `MediaUploader` dengan dropzone
    - Validasi MIME type di client: JPEG, PNG, MP4, PDF, DOCX, XLSX
    - Validasi ukuran ≤ 16MB di client (immediate feedback)
    - Upload ke Supabase Storage bucket `media-attachments`
    - Insert record ke tabel `media_attachments` setelah upload berhasil
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 10.2 Implementasi validasi media di Edge Function
    - Validasi ulang MIME type dan ukuran file di server-side
    - Tolak request jika tidak memenuhi syarat, kembalikan error deskriptif
    - _Requirements: 11.2, 11.3_

  - [ ]* 10.3 Tulis property test untuk validasi media — Property 31
    - **Property 31: Validasi Media (Ukuran dan Format)**
    - **Validates: Requirements 11.2, 11.3**

  - [x] 10.4 Implementasi pratinjau dan caption media
    - Komponen pratinjau media (gambar/video thumbnail/ikon dokumen)
    - Field caption teks pada setiap media yang dilampirkan
    - Tampilkan pratinjau sebelum broadcast dikirim
    - _Requirements: 11.4, 11.5, 11.8_

- [ ] 11. WhatsApp Gateway Service
  - [x] 11.1 Setup project Node.js gateway (`apps/gateway`)
    - Express/Fastify server dengan TypeScript
    - Integrasi Baileys untuk koneksi WhatsApp
    - Session store: simpan file sesi ke direktori persisten (atau Redis)
    - Middleware API key authentication untuk semua endpoint internal
    - _Requirements: 8.1, 8.2_

  - [x] 11.2 Implementasi manajemen sesi WA di gateway
    - `GET /sessions` — daftar sesi aktif
    - `GET /sessions/:id/qr` — stream QR code via SSE hingga terhubung
    - `POST /sessions/:id/disconnect` — putuskan sesi
    - Event handler: `connection.update` → update status ke Supabase via webhook
    - Auto-reconnect logic saat koneksi terputus karena gangguan sementara
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 11.3 Implementasi halaman manajemen sesi WA di frontend (`app/sessions/`)
    - Daftar sesi dengan status (connected/disconnected/expired/pairing)
    - Tampilkan QR code (polling SSE dari gateway via Edge Function proxy)
    - Indikator status dengan update otomatis via Supabase Realtime
    - Tombol disconnect sesi
    - _Requirements: 8.1, 8.2, 8.3, 8.6_

  - [x] 11.4 Implementasi logika sesi expired (30 hari inaktif)
    - Update `last_active_at` setiap kali pesan dikirim via sesi tersebut
    - Hitung `expires_at = last_active_at + 30 days` saat update
    - Scheduled check: tandai sesi sebagai `expired` jika `now() > expires_at`
    - Tampilkan notifikasi di UI jika sesi expired
    - _Requirements: 8.5_

  - [ ]* 11.5 Tulis property test untuk expired sesi — Property 24
    - **Property 24: Sesi Expired Setelah 30 Hari Inaktif**
    - **Validates: Requirements 8.5**

  - [x] 11.6 Implementasi endpoint kirim pesan di gateway
    - `POST /send` — kirim pesan teks atau media ke satu nomor WA
    - Parameter: `{ session_id, to, message, media? }`
    - Return ACK atau error dengan kode error spesifik
    - Download media dari Supabase Storage URL sebelum dikirim
    - _Requirements: 6.6, 11.7_

- [ ] 12. Sistem Antrian Broadcast (BullMQ)
  - [ ] 12.1 Implementasi BullMQ queue di gateway
    - Queue `broadcast-queue` dengan concurrency 1 per sesi
    - Job processor: ambil penerima dari DB, kirim satu per satu
    - Rate limiter: jeda acak `[rate_limit_min_ms, rate_limit_max_ms]` antar pesan
    - _Requirements: 6.5_

  - [ ]* 12.2 Tulis property test untuk rate limiter — Property 18
    - **Property 18: Rate Limiter dalam Batas yang Ditentukan**
    - **Validates: Requirements 6.5**

  - [-] 12.3 Implementasi logika resume broadcast saat gateway terputus
    - Update `last_sent_index` di DB setelah setiap pesan berhasil dikirim
    - Saat gateway reconnect, query broadcast dengan status `paused`
    - Resume dari `last_sent_index + 1`, enqueue ulang ke BullMQ
    - _Requirements: 6.8_

  - [ ]* 12.4 Tulis property test untuk resume broadcast — Property 20
    - **Property 20: Resume Broadcast Tidak Mengirim Ulang Pesan Terkirim**
    - **Validates: Requirements 6.8**

  - [-] 12.5 Implementasi retry logic per pesan gagal
    - Attempt 1: langsung; Attempt 2: delay 5s; Attempt 3: delay 15s
    - Setelah 3 kali gagal: update status message_log = `failed`, lanjut ke penerima berikutnya
    - Catat error code dan error message ke `message_logs`
    - _Requirements: 6.6, 10.4_

  - [-] 12.6 Implementasi endpoint enqueue dan cancel job di gateway
    - `POST /jobs/enqueue` — tambah broadcast job ke queue
    - `DELETE /jobs/:id/cancel` — batalkan job dari queue atau hentikan yang sedang berjalan
    - _Requirements: 6.10_

- [ ] 13. Edge Functions Broadcast dan Webhook
  - [ ] 13.1 Implementasi Edge Function buat broadcast (`supabase/functions/broadcasts/`)
    - Validasi input: title, message_body atau template_id, recipient_type, wa_session_id
    - Resolusi penerima: query semua aktif / anggota grup / manual selection
    - Insert ke `broadcast_jobs` dan `broadcast_recipients` dengan `send_order`
    - Jika `scheduled_at` null: panggil gateway `POST /jobs/enqueue` langsung
    - Jika terjadwal: simpan status `scheduled`, job akan di-trigger oleh scheduler
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 13.2 Tulis property test untuk seleksi penerima — Property 16
    - **Property 16: Recipient Selection Konsisten dengan Kriteria**
    - **Validates: Requirements 6.1, 6.3**

  - [ ]* 13.3 Tulis property test untuk scheduled broadcast — Property 17
    - **Property 17: Scheduled Broadcast Tidak Dikirim Sebelum Waktunya**
    - **Validates: Requirements 6.4**

  - [ ] 13.4 Implementasi Edge Function webhook delivery callback (`supabase/functions/webhooks/`)
    - `PATCH /webhooks/delivery` — terima status pengiriman dari gateway
    - Verifikasi HMAC signature dari gateway
    - Update `message_logs.status`, catat `sent_at`, `error_code`, `error_message`
    - Update `broadcast_jobs.sent_count`, `failed_count`, `last_sent_index`
    - Broadcast Realtime channel untuk progress update ke UI
    - _Requirements: 6.6, 6.9_

  - [ ]* 13.5 Tulis property test untuk semua penerima tercatat — Property 19
    - **Property 19: Semua Penerima Tercatat di message_logs**
    - **Validates: Requirements 6.6, 7.1**

  - [ ]* 13.6 Tulis property test untuk statistik broadcast akurat — Property 21
    - **Property 21: Statistik Broadcast Akurat**
    - **Validates: Requirements 7.3**

  - [ ] 13.7 Implementasi Edge Function cancel dan resume broadcast
    - `PATCH /broadcasts/:id/cancel` — update status ke `cancelled`, batalkan job di queue
    - `PATCH /broadcasts/:id/resume` — update status ke `running`, enqueue ulang dari `last_sent_index + 1`
    - _Requirements: 6.8, 6.10_

- [ ] 14. Halaman Broadcast — Buat dan Kelola
  - [ ] 14.1 Implementasi form buat broadcast baru (`app/broadcasts/new/`)
    - Step 1: Pilih mode penerima (radio: semua / grup / manual)
    - Step 2 (grup): Daftar grup dengan checkbox dan jumlah anggota
    - Step 2 (manual): Daftar kontak dengan checkbox dan search
    - Step 3: Pilih template atau tulis pesan langsung, opsional lampirkan media
    - Step 4: Pilih sesi WA, pilih immediate atau jadwal, pratinjau pesan + media
    - Submit → panggil Edge Function `/broadcasts`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7, 11.8_

  - [ ] 14.2 Implementasi progress broadcast real-time
    - Subscribe ke Supabase Realtime channel `broadcast:{id}`
    - Tampilkan progress bar: terkirim / gagal / tersisa dari total
    - Update counter secara real-time tanpa reload
    - Tombol Cancel yang aktif saat status `running`
    - _Requirements: 6.9, 6.10_

  - [ ]* 14.3 Tulis property test untuk broadcast media ke semua penerima — Property 32
    - **Property 32: Broadcast dengan Media Mengirim Media ke Semua Penerima**
    - **Validates: Requirements 11.7**

- [ ] 15. Riwayat dan Laporan Broadcast
  - [ ] 15.1 Implementasi halaman daftar riwayat broadcast (`app/broadcasts/`)
    - Tabel broadcast jobs: judul, status, total/terkirim/gagal, tanggal dibuat
    - Filter berdasarkan rentang tanggal
    - Paginasi 50 item per halaman
    - _Requirements: 7.1, 7.4_

  - [ ]* 15.2 Tulis property test untuk filter tanggal riwayat — Property 22
    - **Property 22: Filter Tanggal Riwayat Broadcast**
    - **Validates: Requirements 7.4**

  - [ ] 15.3 Implementasi halaman detail broadcast (`app/broadcasts/[id]/`)
    - Ringkasan statistik: persentase keberhasilan, jumlah terkirim, gagal, pending
    - Tabel daftar penerima dengan status masing-masing (terkirim/gagal/pending)
    - Tombol ekspor ke CSV
    - _Requirements: 7.2, 7.3, 7.5_

  - [ ]* 15.4 Tulis property test untuk ekspor CSV round-trip — Property 23
    - **Property 23: Ekspor CSV Round-Trip**
    - **Validates: Requirements 7.5**

- [ ] 16. Checkpoint — Broadcast End-to-End
  - Pastikan alur lengkap buat → kirim → progress real-time → laporan berfungsi
  - Pastikan resume, cancel, dan scheduled broadcast berfungsi benar
  - Pastikan semua tests pass, tanya user jika ada pertanyaan.

- [ ] 17. Auto Reply Berbasis Keyword
  - [ ] 17.1 Implementasi fungsi keyword matching
    - Fungsi `matchKeyword(message: string, rules: KeywordRule[]): KeywordRule | null`
    - Normalize pesan dan keyword ke lowercase sebelum membandingkan
    - Cek apakah pesan mengandung salah satu keyword dari setiap rule aktif
    - Return rule pertama yang cocok, atau null jika tidak ada
    - _Requirements: 12.1, 12.3, 12.5, 12.6_

  - [ ]* 17.2 Tulis property test untuk keyword matching case-insensitive — Property 33
    - **Property 33: Keyword Matching Tidak Case-Sensitive**
    - **Validates: Requirements 12.1**

  - [ ]* 17.3 Tulis property test untuk tidak ada auto reply tanpa kecocokan — Property 34
    - **Property 34: Tidak Ada Auto Reply untuk Pesan Tanpa Kecocokan**
    - **Validates: Requirements 12.6**

  - [ ]* 17.4 Tulis property test untuk rule dinonaktifkan — Property 35
    - **Property 35: Rule Dinonaktifkan Tidak Memicu Auto Reply**
    - **Validates: Requirements 12.5**

  - [ ] 17.5 Implementasi Edge Function webhook pesan masuk (`supabase/functions/webhooks/incoming`)
    - Terima event pesan masuk dari gateway
    - Query `keyword_rules` yang aktif beserta `keyword_triggers`
    - Jalankan `matchKeyword()` terhadap isi pesan
    - Jika cocok: panggil gateway `POST /send` dengan `response_text`
    - Cek tabel `greeted_contacts` untuk pesan sambutan (satu kali per kontak per sesi)
    - Catat ke `activity_logs` setiap auto reply yang dikirim
    - _Requirements: 12.2, 12.4, 12.7, 12.8_

  - [ ]* 17.6 Tulis property test untuk greeting satu kali — Property 36
    - **Property 36: Greeting Dikirim Maksimal Satu Kali per Kontak per Sesi**
    - **Validates: Requirements 12.8**

  - [ ] 17.7 Implementasi halaman manajemen auto reply (`app/auto-reply/`)
    - Daftar Keyword_Rule dengan nama, keyword trigger, status aktif/nonaktif
    - Form buat/edit rule: nama, keyword-keyword pemicu (multi-input), teks respons
    - Toggle aktif/nonaktif tanpa menghapus konfigurasi
    - Checkbox flag `is_greeting` untuk pesan sambutan
    - _Requirements: 12.1, 12.3, 12.4, 12.5, 12.8_

- [ ] 18. Dashboard Admin
  - [ ] 18.1 Implementasi Edge Function statistik dashboard (`supabase/functions/dashboard-stats/`)
    - Hitung: total kontak, pesan terkirim hari ini, pesan gagal hari ini, broadcast aktif
    - Hitung tren 7 hari: aggregasi `message_logs` per hari selama 7 hari terakhir
    - Query status semua `wa_sessions` aktif
    - Return dalam satu response JSON untuk efisiensi
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.8_

  - [ ]* 18.2 Tulis property test untuk akurasi statistik dashboard — Property 1
    - **Property 1: Akurasi Statistik Dashboard**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5**

  - [ ]* 18.3 Tulis property test untuk grafik tren 7 titik data — Property 3
    - **Property 3: Grafik Tren 7 Hari Selalu 7 Titik Data**
    - **Validates: Requirements 1.8**

  - [ ] 18.4 Implementasi halaman dashboard (`app/dashboard/`)
    - Grid kartu statistik: total kontak, terkirim hari ini, gagal hari ini, broadcast aktif
    - Status indikator sesi WA (badge connected/disconnected per sesi)
    - Grafik garis tren 7 hari menggunakan library chart (Recharts atau Chart.js)
    - Semua data dimuat dalam satu request, target < 3 detik
    - Subscribe Realtime ke channel `wa_sessions` untuk update status otomatis
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [ ]* 18.5 Tulis property test untuk realtime update status WA — Property 2
    - **Property 2: Realtime Update Saat Status Berubah**
    - **Validates: Requirements 1.7**

- [ ] 19. Log Aktivitas
  - [ ] 19.1 Implementasi helper fungsi `logActivity()`
    - Fungsi `logActivity({ user_id, action, entity_type, entity_id, detail, ip_address })`
    - Dipanggil dari semua Edge Functions untuk aksi penting
    - Aksi yang dicatat: login, broadcast.create, contact.delete, user.role_change, error.send, auto_reply.sent
    - _Requirements: 10.1, 10.4, 12.7_

  - [ ]* 19.2 Tulis property test untuk setiap aksi penting menghasilkan log — Property 29
    - **Property 29: Setiap Aksi Penting Menghasilkan Entry di activity_logs**
    - **Validates: Requirements 10.1, 10.4, 12.7**

  - [ ] 19.3 Implementasi halaman log aktivitas (`app/logs/`)
    - Tabel log: waktu, jenis aksi, user yang melakukan, detail
    - Filter berdasarkan jenis aksi dan rentang waktu
    - Paginasi 50 item per halaman
    - _Requirements: 10.2_

- [ ] 20. Checkpoint — Semua Fitur Terintegrasi
  - Pastikan auto reply, dashboard, dan log aktivitas berfungsi end-to-end
  - Pastikan Realtime update berfungsi di dashboard dan progress broadcast
  - Pastikan semua tests pass, tanya user jika ada pertanyaan.

- [ ] 21. Integrasi dan Penyambungan Komponen
  - [ ] 21.1 Wiring komponen permission guard di frontend
    - Buat HOC/hook `usePermission(action, resource)` yang query role dari context auth
    - Sembunyikan atau disable UI element berdasarkan role (bukan hanya redirect)
    - Terapkan di semua halaman: kontak (Staff/Operator read-only), users (Owner only), dll.
    - _Requirements: 9.6, 9.7_

  - [ ] 21.2 Implementasi notifikasi UI untuk event sistem
    - Toast notification saat sesi WA terputus (dari Realtime event)
    - Toast notification saat broadcast selesai atau gagal
    - Badge notifikasi di nav jika ada sesi expired
    - _Requirements: 8.3, 1.7_

  - [ ] 21.3 Implementasi layout dan navigasi aplikasi
    - Sidebar navigasi dengan semua route utama
    - Tampilkan nama user dan role di sidebar
    - Conditional menu items berdasarkan role (sembunyikan menu yang tidak diizinkan)
    - Responsive layout untuk layar kecil
    - _Requirements: 9.6_

  - [ ] 21.4 Integrasi penuh alur media dalam broadcast
    - Pastikan media yang diupload di template tersedia saat broadcast dibuat
    - Gateway download media dari Supabase Storage URL saat mengirim
    - Verifikasi media caption ikut terkirim ke semua penerima
    - _Requirements: 11.5, 11.6, 11.7_

- [ ] 22. Pengujian E2E dengan Playwright
  - [ ]* 22.1 Tulis E2E test: alur login dan proteksi route
    - Test login berhasil → redirect ke dashboard
    - Test akses route terproteksi tanpa login → redirect ke login
    - Test logout → sesi dihapus
    - _Requirements: 9.1, 9.4_

  - [ ]* 22.2 Tulis E2E test: alur manajemen kontak
    - Test tambah kontak baru dengan nomor valid
    - Test tambah kontak duplikat → tampilkan error
    - Test import CSV dengan baris valid dan tidak valid
    - _Requirements: 2.2, 2.3, 4.3_

  - [ ]* 22.3 Tulis E2E test: alur buat dan monitor broadcast
    - Test buat broadcast dengan penerima grup (mock gateway)
    - Test progress real-time terupdate saat status berubah
    - Test cancel broadcast yang sedang berjalan
    - _Requirements: 6.1, 6.9, 6.10_

  - [ ]* 22.4 Tulis E2E test: alur QR code pairing sesi WA (mock)
    - Test tampilkan QR code saat inisiasi sesi baru
    - Test status berubah ke connected setelah mock scan
    - _Requirements: 8.1, 8.2_

- [ ] 23. Checkpoint Final — Pastikan semua tests pass, tanya user jika ada pertanyaan.

---

## Catatan

- Task dengan tanda `*` bersifat opsional dan dapat dilewati untuk MVP yang lebih cepat
- Setiap task property test referensikan nomor property dari design document
- Semua property test menggunakan fast-check dengan minimum 100 iterasi
- Setiap property test diberi komentar: `// Feature: whatsapp-broadcast-crm, Property N: ...`
- Komunikasi Edge Function → Gateway menggunakan API key internal (env variable), tidak pernah terekspos ke browser
- Webhook callback dari gateway diverifikasi dengan HMAC signature

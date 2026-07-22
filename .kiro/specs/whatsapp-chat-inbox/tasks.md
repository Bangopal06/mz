# Implementation Plan: WhatsApp Chat Inbox

## Overview

Implementasi dilakukan secara bertahap: database → gateway (inbound) → API route (outbound) → komponen frontend → navigasi → storage. Setiap tahap dapat diuji secara independen sebelum lanjut ke tahap berikutnya.

## Tasks

- [x] 1. Buat migrasi database tabel `chat_messages`
  - Buat file `supabase/migrations/20240101000009_chat_messages.sql`
  - Definisikan tabel `chat_messages` dengan semua kolom, tipe, dan constraint sesuai desain
  - Tambahkan unique constraint `(wa_session_id, wa_message_id)` untuk idempotency
  - Buat tiga indeks: `idx_chat_messages_conversation`, `idx_chat_messages_contact`, `idx_chat_messages_wa_message_id`
  - Aktifkan RLS dan buat policy `authenticated_read_chat_messages` dan `service_role_write_chat_messages`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 10.5_

  - [ ]* 1.1 Tulis property test untuk round-trip penyimpanan pesan
    - **Property 1: Round-trip penyimpanan pesan**
    - **Validates: Requirements 1.1**

  - [ ]* 1.2 Tulis property test untuk idempotency insert duplikat
    - **Property 2: Idempotency insert pesan duplikat**
    - **Validates: Requirements 1.4**

- [x] 2. Update tipe database Supabase dan normalisasi nomor WA
  - Tambahkan definisi tipe `chat_messages` (Row, Insert, Update) ke `apps/web/src/lib/supabase/database.types.ts`
  - Buat fungsi utilitas `normalizeWaNumber(phone: string): string` di `apps/web/src/lib/utils/wa-number.ts`
  - Konversi format `+62xxx`, `08xxx`, `62xxx` ke format standar `62xxx`
  - _Requirements: 1.5_

  - [ ]* 2.1 Tulis property test untuk format nomor WA selalu internasional
    - **Property 3: Format nomor kontak selalu internasional**
    - **Validates: Requirements 1.5**

- [x] 3. Modifikasi Gateway `auto-reply.ts` — simpan pesan inbound
  - Tambahkan fungsi `saveChatMessage()` di `apps/gateway/src/whatsapp/auto-reply.ts` dengan signature sesuai desain
  - Gunakan `ON CONFLICT DO NOTHING` pada constraint `(wa_session_id, wa_message_id)`
  - Panggil `saveChatMessage()` di handler `messages.upsert` **sebelum** logika auto-reply
  - Wrap pemanggilan dalam try-catch: jika gagal, catat error ke log dan lanjutkan auto-reply
  - Handle pesan gambar: download media dari Baileys, upload ke Supabase Storage `chat-media`, simpan `media_url`
  - Skip pesan dari group (suffix `@g.us` pada nomor pengirim)
  - Set `direction = 'inbound'` dan `status = 'received'` untuk semua pesan inbound
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 3.1 Tulis property test untuk pesan inbound selalu disimpan sebelum auto-reply
    - **Property 4: Pesan inbound selalu disimpan sebelum auto-reply**
    - **Validates: Requirements 2.1**

  - [ ]* 3.2 Tulis property test untuk kegagalan DB tidak menghentikan auto-reply
    - **Property 5: Kegagalan DB tidak menghentikan auto-reply**
    - **Validates: Requirements 2.3**

  - [ ]* 3.3 Tulis property test untuk atribut pesan inbound selalu konsisten
    - **Property 6: Atribut pesan inbound selalu konsisten**
    - **Validates: Requirements 2.4, 2.6**

- [ ] 4. Checkpoint — Verifikasi inbound flow
  - Ensure semua tests untuk task 1-3 pass, ask the user if questions arise.

- [x] 5. Buat API Route `POST /api/chat/send`
  - Buat file `apps/web/app/api/chat/send/route.ts`
  - Validasi sesi Supabase Auth; kembalikan 401 jika tidak valid
  - Validasi request body: `session_id`, `to` wajib, serta `message` atau `image_url`
  - Forward request ke endpoint `POST /send` di Gateway dengan payload `{sessionId, to, text}` atau `{sessionId, to, media: {url, mime_type, caption}}`
  - Jika Gateway sukses: INSERT ke `chat_messages` dengan `direction = 'outbound'`, `status = 'sent'`, `wa_message_id` dari respons Gateway
  - Jika Gateway error/timeout: INSERT dengan `status = 'failed'`, kembalikan 502
  - _Requirements: 6.2, 6.3, 6.4, 6.5, 7.5, 7.6, 7.7, 10.3, 10.4_

  - [ ]* 5.1 Tulis property test untuk payload ke Gateway selalu lengkap
    - **Property 12: Payload ke Gateway selalu lengkap**
    - **Validates: Requirements 6.3, 7.6**

  - [ ]* 5.2 Tulis property test untuk pesan outbound berhasil selalu tersimpan konsisten
    - **Property 13: Pesan outbound berhasil selalu tersimpan dengan status konsisten**
    - **Validates: Requirements 6.4, 7.7**

  - [ ]* 5.3 Tulis property test untuk pesan outbound gagal tersimpan status failed
    - **Property 14: Pesan outbound gagal selalu tersimpan dengan status failed**
    - **Validates: Requirements 6.5**

  - [ ]* 5.4 Tulis property test untuk API Route menolak request tanpa autentikasi
    - **Property 22: API Route menolak request tanpa autentikasi**
    - **Validates: Requirements 10.3, 10.4**

- [x] 6. Buat fungsi utilitas frontend dan `database.types.ts` untuk tipe `ChatMessage` dan `ConversationSummary`
  - Definisikan interface `ChatMessage`, `ConversationSummary`, `SendMessageRequest`, `SendMessageResponse` di `apps/web/src/lib/types/chat.ts`
  - Buat fungsi `formatMessageTime(date: string): string` di `apps/web/src/lib/utils/chat-format.ts`
  - Format "HH:mm" untuk hari ini, "Hari HH:mm" untuk hari lain
  - Buat fungsi `truncatePreview(body: string | null, type: 'text' | 'image'): string` — maks 40 karakter, gambar → "Gambar"
  - Buat fungsi `validateImageFile(file: File): { valid: boolean; error?: string }` — hanya JPEG/PNG, maks 5 MB
  - _Requirements: 4.2, 4.3, 5.3, 7.2_

  - [ ]* 6.1 Tulis property test untuk truncate preview maks 40 karakter
    - **Property 8: Preview pesan di InboxPanel tidak melebihi 40 karakter**
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 6.2 Tulis property test untuk validasi file gambar menolak format dan ukuran tidak valid
    - **Property 16: Validasi file gambar menolak format dan ukuran tidak valid**
    - **Validates: Requirements 7.2**

- [x] 7. Buat Server Component `app/(app)/chat/page.tsx`
  - Buat file `apps/web/app/(app)/chat/page.tsx`
  - Redirect ke `/login` jika tidak ada sesi auth (Requirements 10.1, 10.2)
  - Query Supabase server-side: ambil semua `wa_sessions` dengan `status = 'connected'`
  - Query Supabase server-side: ambil daftar percakapan awal via query `DISTINCT ON (contact_wa_number)` join `contacts`
  - Pass `initialSessions` dan `initialConversations` ke `ChatClient` sebagai props
  - _Requirements: 3.1, 3.4, 3.5, 9.1, 10.1, 10.2_

- [x] 8. Buat komponen `InboxPanel`
  - Buat file `apps/web/app/(app)/chat/_components/InboxPanel.tsx`
  - Render daftar `ConversationSummary` dengan nama/nomor kontak, preview pesan (max 40 char), waktu relatif
  - Tampilkan ikon kamera + "Gambar" untuk pesan bertipe `image`
  - Highlight entri aktif dengan background berbeda
  - Implementasi search input di bagian atas — filter case-insensitive berdasarkan nama atau nomor
  - Tampilkan "Tidak ada percakapan ditemukan" jika hasil kosong
  - Emit `onSelectContact` saat entri diklik
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]* 8.1 Tulis property test untuk InboxPanel menampilkan entri unik per kontak terurut terbaru
    - **Property 7: InboxPanel menampilkan entri unik per kontak terurut terbaru**
    - **Validates: Requirements 4.1**

  - [ ]* 8.2 Tulis property test untuk pencarian InboxPanel hanya mengembalikan hasil relevan
    - **Property 9: Pencarian InboxPanel hanya mengembalikan hasil relevan**
    - **Validates: Requirements 4.6**

- [x] 9. Buat komponen `ChatPanel`
  - Buat file `apps/web/app/(app)/chat/_components/ChatPanel.tsx`
  - Header: tampilkan nama + nomor kontak, dropdown pemilihan WA_Session (hanya `connected`)
  - Fetch 50 pesan terbaru dari Supabase saat `contact` berubah, urutkan ascending by `created_at`
  - Implementasi pagination: ketika scroll ke atas dan mencapai top, load 50 pesan berikutnya (offset-based)
  - Auto-scroll ke bawah setelah pesan pertama dimuat atau pesan baru masuk
  - Render bubble: inbound di kiri (warna berbeda), outbound di kanan
  - Tampilkan thumbnail gambar di bubble; klik → lightbox full-screen
  - Tampilkan waktu per bubble sesuai `formatMessageTime()`
  - Input teks + tombol kirim (Enter atau klik) → POST `/api/chat/send`
  - Tombol lampiran → pilih file, jalankan `validateImageFile()`, tampilkan preview thumbnail + tombol batal
  - Disable input + tombol kirim jika tidak ada sesi aktif; tampilkan pesan peringatan
  - Tampilkan state kosong ("Pilih percakapan...") jika tidak ada kontak yang dipilih
  - _Requirements: 3.1, 3.3, 3.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.6, 6.7, 6.8, 7.1, 7.2, 7.3, 7.4, 9.1, 9.2_

  - [ ]* 9.1 Tulis property test untuk pesan dalam ChatPanel selalu urut kronologis ascending
    - **Property 10: Pesan dalam ChatPanel selalu urut kronologis ascending**
    - **Validates: Requirements 5.1**

  - [ ]* 9.2 Tulis property test untuk pagination ChatPanel tidak melebihi 50 per halaman
    - **Property 11: Pagination ChatPanel tidak melebihi batas per halaman**
    - **Validates: Requirements 5.5**

  - [ ]* 9.3 Tulis property test untuk input kirim nonaktif ketika tidak ada sesi aktif
    - **Property 15: Input kirim nonaktif ketika tidak ada sesi aktif**
    - **Validates: Requirements 6.7, 9.4**

  - [ ]* 9.4 Tulis property test untuk dropdown sesi hanya menampilkan sesi connected
    - **Property 20: Dropdown sesi hanya menampilkan sesi connected**
    - **Validates: Requirements 9.1**

- [x] 10. Buat komponen `ChatClient` dan pasang Supabase Realtime
  - Buat file `apps/web/app/(app)/chat/_components/ChatClient.tsx`
  - Terima `initialSessions` dan `initialConversations` sebagai props
  - Kelola state: `selectedContact`, `selectedSessionId`, `conversations`, `sessions`
  - Subscribe ke channel Supabase Realtime `chat_messages` event INSERT saat komponen mount
  - Saat INSERT event diterima:
    - Jika `contact_wa_number` cocok dengan `selectedContact` → tambah pesan ke ChatPanel
    - Jika kontak berbeda → pindahkan entri ke posisi teratas InboxPanel dengan preview diperbarui
  - Unsubscribe dan cleanup saat komponen unmount
  - Filter `conversations` berdasarkan `selectedSessionId` jika dipilih
  - Tampilkan indikator status koneksi Realtime; reconnect otomatis sudah dihandle Supabase client
  - _Requirements: 3.1, 8.1, 8.2, 8.3, 8.4, 8.5, 9.3, 9.5_

  - [ ]* 10.1 Tulis property test untuk Realtime update tampil di percakapan yang aktif
    - **Property 18: Realtime update tampil di percakapan yang aktif**
    - **Validates: Requirements 8.2**

  - [ ]* 10.2 Tulis property test untuk InboxPanel diperbarui untuk pesan kontak yang tidak aktif
    - **Property 19: InboxPanel diperbarui untuk pesan kontak yang tidak aktif**
    - **Validates: Requirements 8.3**

  - [ ]* 10.3 Tulis property test untuk filter sesi menghasilkan percakapan konsisten
    - **Property 21: Filter sesi menghasilkan percakapan yang konsisten**
    - **Validates: Requirements 9.3**

- [x] 11. Tambahkan navigasi menu "Chat" di sidebar
  - Modifikasi komponen sidebar di `apps/web` untuk menambah link ke `/chat`
  - Gunakan ikon yang sesuai (misal: `MessageSquare` dari lucide-react)
  - Pastikan link aktif ter-highlight saat berada di path `/chat`
  - _Requirements: 3.5_

- [x] 12. Buat Supabase Storage bucket `chat-media`
  - Tambahkan konfigurasi bucket `chat-media` di migration atau seed script
  - Set bucket sebagai public untuk read
  - Tambahkan storage policy: authenticated users dapat upload
  - Struktur folder: `{session_id}/{contact_wa_number}/{timestamp}_{filename}`
  - Batasan: hanya `image/jpeg` dan `image/png`, enforced di frontend
  - _Requirements: 7.5, 2.5_

- [x] 13. Implementasi responsive mobile layout
  - Modifikasi `ChatClient.tsx` atau `chat/page.tsx` untuk mendeteksi viewport mobile (< 768px)
  - Pada mobile: tampilkan hanya `InboxPanel` atau `ChatPanel` secara bergantian
  - Tambahkan tombol "Kembali" di `ChatPanel` untuk kembali ke `InboxPanel` pada mobile
  - _Requirements: 3.6_

- [ ] 14. Checkpoint final — Ensure all tests pass
  - Ensure semua tests pass, ask the user if questions arise.

## Notes

- Tasks bertanda `*` adalah opsional dan dapat dilewati untuk MVP yang lebih cepat
- Setiap task merujuk ke requirements spesifik untuk traceability
- Property tests menggunakan **fast-check** (tersedia di root `node_modules/`)
- Setiap property test dikonfigurasi minimum 100 iterasi
- Tag komentar format: `// Feature: whatsapp-chat-inbox, Property N: <teks property>`
- Gateway (task 3) perlu akses `sessionDbId` (UUID wa_sessions) — pastikan sudah tersedia di context handler Baileys

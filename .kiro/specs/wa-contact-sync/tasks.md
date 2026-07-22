# Implementation Plan

- [ ] 1. Tulis bug condition exploration test
  - **Property 1: Fault Condition** - Kontak WA Sync Tidak Terhapus Saat Sesi Dihapus
  - **CRITICAL**: Test ini HARUS GAGAL di kode unfixed — kegagalan membuktikan bug ada
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: Test ini mengkodekan expected behavior — akan memvalidasi fix saat passing setelah implementasi
  - **GOAL**: Dapatkan counterexample yang membuktikan bug exists
  - **Scoped PBT Approach**: Scope ke kasus konkret: insert kontak via syncContacts → hapus sesi → assert kontak ikut terhapus
  - Test Case 1 — Schema Column Test: Query kolom `source` dan `source_session_id` dari tabel `contacts` → assert kolom ada (akan GAGAL di unfixed karena kolom belum ada di schema)
  - Test Case 2 — Gateway Payload Test: Intercept payload upsert dari `syncContacts` → assert payload mengandung field `source: 'wa_sync'` dan `source_session_id` (akan GAGAL di unfixed karena gateway tidak mengirim field tersebut)
  - Test Case 3 — Cascade Delete Test: Insert kontak via `syncContacts` dari sesi tertentu → delete sesi → assert `SELECT contacts WHERE source_session_id = session.id` mengembalikan 0 row (akan GAGAL di unfixed karena cascade delete belum ada)
  - Dari `isBugCondition(X)`: `X.source = 'wa_sync' AND X.source_session_id IS NULL`
  - Jalankan test di kode UNFIXED
  - **EXPECTED OUTCOME**: Test GAGAL (ini benar — membuktikan bug ada)
  - Dokumentasikan counterexample: "Kontak tetap ada setelah sesi dihapus", "payload gateway tidak mengandung `source_session_id`", "kolom `source` tidak ada di schema"
  - Tandai task selesai setelah test ditulis, dijalankan, dan kegagalan didokumentasikan
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. Tulis preservation property tests (SEBELUM mengimplementasi fix)
  - **Property 2: Preservation** - Kontak Manual Tidak Terpengaruh Penghapusan Sesi
  - **IMPORTANT**: Ikuti observation-first methodology
  - Observe di kode UNFIXED: `SELECT contacts WHERE source != 'wa_sync'` → catat jumlah dan data kontak manual yang ada
  - Observe: delete sesi di kode unfixed → kontak manual masih ada (karena bug — tidak ada cascade delete sama sekali)
  - Tulis property-based test: untuk semua kontak dengan `source = 'manual'` (atau `source IS NULL` di unfixed code), jumlah dan data kontak sebelum dan sesudah delete sesi harus identik
  - Test Case 1 — Manual Contact Preservation: Insert 10 kontak manual + 10 kontak wa_sync → delete sesi → assert 10 kontak manual masih ada persis
  - Test Case 2 — Multi-Session Isolation: Insert kontak dari 2 sesi berbeda → delete satu sesi → assert kontak sesi lain tidak ikut terhapus
  - Test Case 3 — Disconnect Preservation: Disconnect sesi (bukan delete) → assert semua kontak tetap ada tanpa perubahan
  - Property: `∀ contact c WHERE c.source = 'manual': c EXISTS after session delete AND c.data UNCHANGED`
  - Jalankan tests di kode UNFIXED
  - **EXPECTED OUTCOME**: Tests PASS (ini mengkonfirmasi baseline behavior yang harus dipertahankan)
  - Tandai task selesai setelah tests ditulis, dijalankan, dan passing di unfixed code
  - _Requirements: 3.1, 3.2, 3.5_

- [ ] 3. Fix: Tambah kolom source dan cascade delete ke contacts

  - [ ] 3.1 Buat migration baru `supabase/migrations/20240101000005_contacts_source_columns.sql`
    - Tambah kolom `source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'wa_sync'))` ke tabel `contacts`
    - Tambah kolom `source_session_id UUID REFERENCES wa_sessions(id) ON DELETE SET NULL`
    - Tambah index `idx_contacts_source_session` pada `(source_session_id)` untuk performa cascade delete query
    - Tambah constraint: `source_session_id` hanya boleh diisi jika `source = 'wa_sync'`
    - _Bug_Condition: isBugCondition(X) = X.source = 'wa_sync' AND X.source_session_id IS NULL_
    - _Expected_Behavior: Setelah migration, setiap kontak wa_sync memiliki source_session_id yang valid sehingga bisa di-cascade delete saat sesinya dihapus_
    - _Preservation: Kontak yang sudah ada mendapat DEFAULT 'manual' — tidak ada data yang hilang_
    - _Requirements: 1.2, 2.2_

  - [ ] 3.2 Perbarui `apps/gateway/src/whatsapp/contact-sync.ts`
    - Tambah parameter `sessionId: string` (UUID sesi dari DB) ke fungsi `syncContacts` dan `watchContactsUpsert`
    - Tambah `source: 'wa_sync'` dan `source_session_id: sessionId` ke setiap record yang di-upsert ke Supabase
    - Ubah `Prefer` header dari `ignore-duplicates` ke `resolution=merge-duplicates` agar `source` dan `source_session_id` diperbarui jika kontak sudah ada
    - Pastikan caller `syncContacts` dan `watchContactsUpsert` meneruskan sessionId yang benar
    - _Bug_Condition: isBugCondition(X) = X.source = 'wa_sync' AND X.source_session_id IS NULL_
    - _Expected_Behavior: Setiap upsert kontak dari sync WA menyertakan source_session_id yang valid_
    - _Preservation: Fungsi sync tetap berjalan untuk kontak yang sudah ada (merge, bukan skip)_
    - _Requirements: 1.2, 2.2_

  - [ ] 3.3 Buat edge function baru `supabase/functions/delete-session/index.ts`
    - Terima `session_id` dari request body
    - Query jumlah kontak `wa_sync` dengan `source_session_id = session_id` (untuk response ke UI)
    - Delete semua kontak dengan `source = 'wa_sync' AND source_session_id = session_id`
    - Delete record `wa_sessions` dengan `id = session_id`
    - Return `{ deleted_contacts_count: number }` ke client
    - Handle edge case: sesi tidak ditemukan, sesi tanpa kontak wa_sync
    - _Bug_Condition: isBugCondition(X) = X.source = 'wa_sync' AND X.source_session_id IS NULL_
    - _Expected_Behavior: expectedBehavior = COUNT(contacts WHERE source_session_id = deleted_session.id) = 0 setelah delete_
    - _Preservation: Kontak manual (source = 'manual') tidak di-delete oleh edge function ini_
    - _Requirements: 1.1, 1.3, 2.1_

  - [ ] 3.4 Perbarui `apps/web/app/(app)/sessions/_components/SessionsClient.tsx`
    - Saat user klik "Hapus Sesi", fetch jumlah kontak `wa_sync` dari sesi tersebut via Supabase query sebelum menampilkan modal konfirmasi
    - Tampilkan jumlah kontak yang akan ikut terhapus di dialog konfirmasi (warning message)
    - Ubah `handleDelete` untuk memanggil edge function `delete-session` alih-alih langsung delete dari client
    - Handle response edge function untuk menampilkan notifikasi sukses dengan jumlah kontak terhapus
    - _Requirements: 2.1, 2.3_

  - [ ] 3.5 Verifikasi exploration test sekarang passing
    - **Property 1: Expected Behavior** - Cascade Delete Kontak WA Sync saat Sesi Dihapus
    - **IMPORTANT**: Jalankan ulang test YANG SAMA dari task 1 — JANGAN tulis test baru
    - Test dari task 1 mengkodekan expected behavior
    - Saat test ini passing, ini mengkonfirmasi expected behavior terpenuhi
    - Jalankan bug condition exploration test dari step 1
    - **EXPECTED OUTCOME**: Test PASS (mengkonfirmasi bug telah diperbaiki)
    - _Requirements: 2.1, 2.2_

  - [ ] 3.6 Verifikasi preservation tests masih passing
    - **Property 2: Preservation** - Kontak Manual Tidak Terpengaruh Penghapusan Sesi
    - **IMPORTANT**: Jalankan ulang test YANG SAMA dari task 2 — JANGAN tulis test baru
    - Jalankan preservation property tests dari step 2
    - **EXPECTED OUTCOME**: Tests PASS (mengkonfirmasi tidak ada regresi)
    - Konfirmasi semua kontak manual tetap ada setelah fix diterapkan

- [ ] 4. Checkpoint — Pastikan semua tests passing
  - Jalankan seluruh test suite untuk memastikan tidak ada regresi
  - Verifikasi: exploration test dari task 1 kini PASS (bug fixed)
  - Verifikasi: preservation tests dari task 2 masih PASS (no regressions)
  - Verifikasi: kolom `source` dan `source_session_id` ada di schema dan terisi dengan benar
  - Verifikasi: UI menampilkan warning jumlah kontak sebelum konfirmasi hapus sesi
  - Tanya user jika ada pertanyaan atau keputusan bisnis yang belum jelas (misal: broadcast history integrity saat kontak wa_sync dihapus)

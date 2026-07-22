# WA Contact Sync — Bugfix Design

## Overview

Bug ini terjadi karena tabel `contacts` tidak memiliki kolom `source` dan `source_session_id`,
sehingga sistem tidak bisa membedakan kontak hasil sync WA dari kontak manual, dan tidak bisa
melakukan cascade delete kontak saat sesi WA dihapus.

Fix ini menambah dua kolom ke tabel `contacts`, memperbarui gateway untuk menyimpan referensi
sesi saat sync, menambah cascade delete di edge function delete session, dan memperbarui UI
konfirmasi hapus sesi dengan warning jumlah kontak terdampak.

## Glossary

- **Bug_Condition (C)**: Kondisi di mana kontak hasil sync WA tidak memiliki `source_session_id`,
  sehingga tidak bisa di-cascade delete saat sesi asalnya dihapus
- **Property (P)**: Perilaku yang diharapkan — semua kontak `wa_sync` dari sesi yang dihapus
  ikut terhapus secara otomatis
- **Preservation**: Kontak `manual` dan data riwayat broadcast tidak boleh terpengaruh oleh fix ini
- **syncContacts / watchContactsUpsert**: Fungsi di `apps/gateway/src/whatsapp/contact-sync.ts`
  yang mensinkronisasi kontak dari Baileys ke Supabase
- **source**: Enum kolom baru di `contacts` — nilai `'manual'` atau `'wa_sync'`
- **source_session_id**: FK nullable baru di `contacts` yang mereferensikan `wa_sessions.id`

## Bug Details

### Fault Condition

Bug terpicu saat kontak disinkronisasi dari WA tanpa menyimpan asal sesinya (`source_session_id IS NULL` dan `source = 'wa_sync'`), sehingga ketika sesi dihapus tidak ada cara untuk menemukan dan menghapus kontak-kontak tersebut.

**Formal Specification:**
```
FUNCTION isBugCondition(X)
  INPUT: X of type ContactRecord
  OUTPUT: boolean

  RETURN X.source = 'wa_sync'
         AND X.source_session_id IS NULL
END FUNCTION
```

### Examples

- Sesi `sesi-utama` dihapus → 150 kontak hasil sync dari sesi itu tetap ada di DB (bug)
- Kontak disync dari `sesi-utama` → record tersimpan tanpa `source_session_id` (root cause)
- Sesi baru dibuat dengan nomor yang sama, sync ulang → duplikat kontak bisa muncul
- Kontak ditambah manual → tidak terpengaruh penghapusan sesi manapun (correct, harus dipertahankan)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Kontak dengan `source = 'manual'` tidak terhapus meskipun ada sesi WA yang dihapus
- Kontak yang diimport via CSV/XLSX (`source = 'manual'`) tetap tersimpan secara independen
- Operasi disconnect sesi hanya mengubah status sesi, tidak menyentuh kontak sama sekali
- Data `broadcast_recipients` dan `message_logs` yang sudah ada tetap valid (integritas historis)
- Penambahan kontak manual dan import tetap berfungsi seperti sebelumnya

**Scope:**
Semua input yang BUKAN operasi delete sesi tidak boleh terpengaruh oleh fix ini. Ini meliputi:
- CRUD kontak manual
- Disconnect sesi
- Broadcast job creation dan execution
- Import kontak CSV/XLSX

## Hypothesized Root Cause

Berdasarkan analisis kode di `contact-sync.ts` dan schema `initial_schema.sql`:

1. **Kolom Tidak Ada di Schema**: Tabel `contacts` di `initial_schema.sql` tidak memiliki kolom
   `source` dan `source_session_id`, sehingga data tersebut tidak pernah tersimpan

2. **Gateway Tidak Mengirim source_session_id**: Fungsi `syncContacts` dan `watchContactsUpsert`
   di `contact-sync.ts` hanya mengirim `{ full_name, wa_number }` — tidak ada `source` maupun
   `source_session_id` dalam payload upsert ke Supabase

3. **Tidak Ada Cascade Delete di Delete Session Flow**: Handler delete sesi (baik di edge function
   maupun di `SessionsClient.tsx`) langsung delete record `wa_sessions` tanpa terlebih dahulu
   menghapus kontak yang berasal dari sesi tersebut

4. **Tidak Ada Edge Function untuk Delete Session**: Saat ini delete sesi dilakukan langsung dari
   client via Supabase client (`supabase.from('wa_sessions').delete()`), sehingga tidak ada
   server-side logic untuk menjalankan cleanup sebelum delete

## Correctness Properties

Property 1: Fault Condition — Cascade Delete Kontak WA Sync saat Sesi Dihapus

_For any_ sesi WhatsApp yang dihapus di mana terdapat kontak dengan `source = 'wa_sync'` dan
`source_session_id = session.id` (isBugCondition returns true untuk kontak-kontak tersebut
sebelum fix diterapkan), fungsi delete session yang telah diperbaiki SHALL menghapus semua
kontak tersebut sehingga tidak ada kontak `wa_sync` yang tersisa dengan `source_session_id`
mereferensikan sesi yang sudah dihapus.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation — Kontak Manual Tidak Terpengaruh Penghapusan Sesi

_For any_ sesi WhatsApp yang dihapus, semua kontak dengan `source = 'manual'` (isBugCondition
returns false) SHALL tetap tersimpan dan tidak berubah — jumlah dan data kontak manual sebelum
dan sesudah delete sesi harus identik.

**Validates: Requirements 3.1, 3.2, 3.5**

## Fix Implementation

### Changes Required

Asumsi root cause analysis di atas benar, perubahan yang diperlukan adalah:

**File 1: `supabase/migrations/20240101000005_contacts_source_columns.sql`** (baru)

Tambah kolom `source` dan `source_session_id` ke tabel `contacts`:
1. Tambah kolom `source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'wa_sync'))`
2. Tambah kolom `source_session_id UUID REFERENCES wa_sessions(id) ON DELETE SET NULL`
3. Tambah index `idx_contacts_source_session` pada `(source_session_id)` untuk performa query cascade delete
4. Constraint: `source_session_id` hanya boleh diisi jika `source = 'wa_sync'`

**File 2: `apps/gateway/src/whatsapp/contact-sync.ts`**

Perbarui `syncContacts` dan `watchContactsUpsert` untuk menerima dan menyimpan `sessionId`:
1. Tambah parameter `sessionId: string` (UUID sesi dari DB) ke kedua fungsi
2. Tambah `source: 'wa_sync'` dan `source_session_id: sessionId` ke setiap record yang di-upsert
3. Ubah `Prefer` header ke `resolution=merge-duplicates` agar `source` dan `source_session_id`
   diperbarui jika kontak sudah ada (sebelumnya `ignore-duplicates` melewati update)

**File 3: `supabase/functions/delete-session/index.ts`** (baru)

Buat Edge Function baru untuk handle delete sesi dengan cascade delete kontak:
1. Terima `session_id` dari request
2. Query jumlah kontak `wa_sync` yang akan terhapus (untuk response ke UI)
3. Delete kontak dengan `source = 'wa_sync' AND source_session_id = session_id`
4. Delete record `wa_sessions`
5. Return `{ deleted_contacts_count }` ke client

**File 4: `apps/web/app/(app)/sessions/_components/SessionsClient.tsx`**

Perbarui delete flow di UI:
1. Saat user klik "Hapus Sesi", fetch jumlah kontak yang akan terhapus via Supabase query
   sebelum menampilkan modal konfirmasi
2. Tampilkan jumlah kontak `wa_sync` yang akan ikut terhapus di dialog konfirmasi
3. Ubah `handleDelete` untuk memanggil edge function `delete-session` alih-alih langsung delete
   dari client

## Testing Strategy

### Validation Approach

Strategi dua fase: pertama, jalankan test di kode UNFIXED untuk mendapatkan counterexample yang
membuktikan bug. Kedua, verifikasi fix bekerja dan behavior yang ada tidak berubah.

### Exploratory Fault Condition Checking

**Goal**: Buktikan bug dengan counterexample sebelum implementasi fix. Konfirmasi root cause.

**Test Plan**: Buat test yang mensimulasikan sync kontak ke DB lalu hapus sesi, kemudian assert
bahwa kontak tersebut ikut terhapus. Jalankan di kode UNFIXED — test harus GAGAL.

**Test Cases**:
1. **Sync then Delete Test**: Insert kontak via `syncContacts` → delete sesi → assert kontak
   masih ada (akan fail pada kode unfixed karena cascade delete belum ada) (akan fail pada unfixed)
2. **Schema Column Test**: Query kolom `source` dan `source_session_id` dari `contacts` — akan
   error karena kolom belum ada (akan fail pada unfixed)
3. **Gateway Payload Test**: Intercept payload yang dikirim gateway ke Supabase dan assert ada
   field `source_session_id` — akan fail karena gateway tidak mengirim field tersebut (akan fail pada unfixed)

**Expected Counterexamples**:
- Kontak tetap ada setelah sesi dihapus (cascade delete tidak terjadi)
- Payload gateway tidak mengandung `source_session_id`
- Possible causes: kolom tidak ada di schema, gateway tidak mengirim data sesi, tidak ada delete logic

### Fix Checking

**Goal**: Setelah fix diterapkan, verifikasi bahwa semua kontak `wa_sync` terhapus saat sesinya dihapus.

**Pseudocode:**
```
FOR ALL session S WHERE S is being deleted DO
  wa_sync_contacts_before ← SELECT contacts
    WHERE source = 'wa_sync' AND source_session_id = S.id

  ASSERT COUNT(wa_sync_contacts_before) > 0  // ada kontak untuk dihapus

  DELETE session S via delete-session edge function

  wa_sync_contacts_after ← SELECT contacts
    WHERE source_session_id = S.id

  ASSERT COUNT(wa_sync_contacts_after) = 0
END FOR
```

### Preservation Checking

**Goal**: Verifikasi bahwa kontak manual tidak terpengaruh saat sesi WA dihapus.

**Pseudocode:**
```
FOR ALL session S WHERE S is being deleted DO
  manual_contacts_before ← SELECT contacts WHERE source = 'manual'

  DELETE session S via delete-session edge function

  manual_contacts_after ← SELECT contacts WHERE source = 'manual'

  ASSERT COUNT(manual_contacts_before) = COUNT(manual_contacts_after)
  ASSERT manual_contacts_before = manual_contacts_after
END FOR
```

**Testing Approach**: Property-based testing direkomendasikan untuk preservation checking karena:
- Dapat generate banyak kombinasi kontak manual + sesi secara otomatis
- Menangkap edge case seperti kontak yang dipakai di broadcast sebelum sesi dihapus
- Memberikan jaminan kuat bahwa tidak ada kontak manual yang terhapus di berbagai skenario

**Test Cases**:
1. **Manual Contact Preservation**: Insert 10 kontak manual + 10 kontak wa_sync → delete sesi →
   assert 10 kontak manual masih ada, 10 kontak wa_sync terhapus
2. **Disconnect Preservation**: Disconnect sesi (bukan delete) → assert semua kontak tetap ada
3. **Multi-Session Isolation**: Insert kontak dari 2 sesi berbeda → delete satu sesi → assert
   hanya kontak dari sesi yang dihapus yang ikut terhapus, kontak sesi lain tetap ada
4. **Broadcast History Integrity**: Kontak wa_sync yang sudah ada di `broadcast_recipients` —
   perlu diputuskan apakah cascade delete kontak diizinkan atau kontak diubah menjadi `manual`
   sebelum dihapus (edge case, perlu keputusan bisnis)

### Unit Tests

- Test `syncContacts` mengirim `source: 'wa_sync'` dan `source_session_id` yang benar
- Test `watchContactsUpsert` menyertakan session reference di payload
- Test edge function `delete-session` menghapus kontak wa_sync sebelum menghapus sesi
- Test edge case: delete sesi yang tidak memiliki kontak wa_sync sama sekali
- Test edge case: delete sesi ketika `source_session_id` sudah NULL (kontak sudah dihapus manual)

### Property-Based Tests

- Generate random set kontak (`manual` dan `wa_sync`) untuk N sesi → hapus satu sesi →
  verifikasi hanya kontak sesi tersebut yang terhapus (invariant: jumlah kontak manual tetap)
- Generate berbagai kombinasi status sesi (connected, disconnected, expired) → verifikasi
  disconnect tidak menghapus kontak di semua status
- Generate kontak wa_sync dari berbagai sesi → hapus satu per satu → verifikasi tidak ada
  cross-session deletion

### Integration Tests

- Full flow: tambah sesi → scan QR → sync kontak → hapus sesi → verifikasi kontak terhapus
- UI flow: buka dialog hapus sesi → verifikasi warning jumlah kontak tampil dengan benar
- Multi-session flow: dua sesi aktif dengan kontak berbeda → hapus satu → verifikasi isolasi
- Broadcast integrity: buat broadcast dengan kontak wa_sync → hapus sesi → verifikasi riwayat
  broadcast tidak corrupt (message_logs dan broadcast_recipients masih ada)

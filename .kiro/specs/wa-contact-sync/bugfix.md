# Bugfix Requirements Document

## Introduction

Bug ini terjadi pada fitur sinkronisasi kontak WhatsApp di aplikasi WhatsApp Broadcast CRM.
Saat ini, kontak yang masuk ke sistem melalui sinkronisasi sesi WhatsApp tidak terikat ke sesi asal mereka.
Akibatnya, ketika sebuah sesi WA dihapus dari sistem, kontak-kontak yang berasal dari sesi tersebut tetap ada — menyebabkan data kontak "orphan" yang tidak lagi relevan dan tidak bisa disinkronisasi ulang dengan benar.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN sebuah WhatsApp_Session dihapus dari sistem THEN kontak-kontak yang disinkronisasi dari sesi tersebut tetap tersimpan di tabel `contacts` tanpa terhapus

1.2 WHEN kontak disimpan ke sistem melalui sinkronisasi WA THEN sistem tidak mencatat asal sesi mana kontak tersebut disinkronisasi (tidak ada `source_session_id` pada data kontak)

1.3 WHEN Admin menghapus WhatsApp_Session THEN sistem hanya menghapus record sesi dari tabel `wa_sessions` tanpa menelusuri atau menghapus kontak turunannya

### Expected Behavior (Correct)

2.1 WHEN sebuah WhatsApp_Session dihapus dari sistem THEN sistem SHALL menghapus semua kontak yang berstatus `synced` dan berasal dari sesi tersebut secara otomatis (cascade delete berdasarkan relasi sesi-kontak)

2.2 WHEN kontak disinkronisasi dari WhatsApp_Session THEN sistem SHALL menyimpan referensi `source_session_id` pada record kontak tersebut sehingga asal sesi dapat ditelusuri

2.3 WHEN sebuah WhatsApp_Session hanya di-disconnect (bukan dihapus) THEN sistem SHALL mempertahankan semua kontak yang berasal dari sesi tersebut tanpa perubahan

### Unchanged Behavior (Regression Prevention)

3.1 WHEN Admin menambahkan kontak secara manual (bukan via sinkronisasi WA) THEN sistem SHALL CONTINUE TO menyimpan kontak tersebut dan tidak menghapusnya meskipun ada sesi WA yang dihapus

3.2 WHEN Admin menghapus kontak secara manual THEN sistem SHALL CONTINUE TO meminta konfirmasi dan menghapus kontak tersebut secara permanen seperti sebelumnya

3.3 WHEN kontak digunakan sebagai penerima dalam Broadcast_Job yang sudah selesai atau sedang berjalan THEN sistem SHALL CONTINUE TO mempertahankan integritas data riwayat broadcast (relasi `broadcast_recipients` dan `message_logs` tetap valid)

3.4 WHEN WhatsApp_Session di-disconnect lalu di-reconnect ulang THEN sistem SHALL CONTINUE TO mempertahankan kontak yang sudah ada dan hanya menambah kontak baru yang belum tersinkronisasi

3.5 WHEN Admin melakukan import kontak via CSV/XLSX THEN sistem SHALL CONTINUE TO menyimpan kontak tersebut secara independen dari sesi WA manapun

---

## Bug Condition Derivation

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type ContactRecord
  OUTPUT: boolean

  // Bug terpicu ketika kontak tidak memiliki referensi ke sesi asal
  // sehingga tidak bisa di-cascade delete saat sesi dihapus
  RETURN X.source_session_id IS NULL AND X.source = 'wa_sync'
END FUNCTION
```

### Property: Fix Checking

```pascal
// Property: Cascade Delete saat Sesi Dihapus
FOR ALL session S WHERE S is being deleted DO
  contacts_before ← SELECT contacts WHERE source_session_id = S.id AND source = 'wa_sync'
  DELETE session S
  contacts_after ← SELECT contacts WHERE source_session_id = S.id
  ASSERT COUNT(contacts_after) = 0
END FOR
```

### Property: Preservation Checking

```pascal
// Property: Kontak manual dan non-sync tidak terpengaruh
FOR ALL session S WHERE S is being deleted DO
  manual_contacts_before ← SELECT contacts WHERE source != 'wa_sync' OR source_session_id != S.id
  DELETE session S
  manual_contacts_after ← SELECT contacts WHERE source != 'wa_sync' OR source_session_id != S.id
  ASSERT F(manual_contacts_before) = F'(manual_contacts_after)
END FOR
```

-- Migration: 20240101000012_normalize_wa_numbers.sql
-- Normalize wa_number in contacts table: leading 0 → 62
-- Fixes mismatch between contact-sync (stored 08xxx) and chat_messages (stored 62xxx)

UPDATE contacts
SET wa_number = '62' || substring(wa_number FROM 2)
WHERE wa_number LIKE '0%';

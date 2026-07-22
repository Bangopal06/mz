-- Migration: 20240101000009_chat_messages.sql
-- Creates the chat_messages table for WhatsApp Chat Inbox feature
-- Requirements: 1.1, 1.2, 1.3, 1.4, 10.5

CREATE TABLE chat_messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wa_session_id       UUID NOT NULL REFERENCES wa_sessions(id) ON DELETE CASCADE,
    contact_wa_number   TEXT NOT NULL,
    direction           TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    message_type        TEXT NOT NULL CHECK (message_type IN ('text', 'image')),
    body                TEXT,
    media_url           TEXT,
    wa_message_id       TEXT,
    status              TEXT NOT NULL CHECK (status IN ('received', 'sent', 'delivered', 'read', 'failed')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Unique constraint untuk mencegah duplikat dari Baileys (Requirement 1.4)
    CONSTRAINT chat_messages_unique_wa_msg UNIQUE (wa_session_id, wa_message_id)
);

-- Indeks utama untuk query riwayat percakapan (Requirement 1.2)
CREATE INDEX idx_chat_messages_conversation
    ON chat_messages(wa_session_id, contact_wa_number, created_at DESC);

-- Indeks untuk query daftar percakapan unik per nomor (Requirement 1.3)
CREATE INDEX idx_chat_messages_contact
    ON chat_messages(contact_wa_number);

-- Indeks untuk lookup by wa_message_id (status update dari Baileys ACK)
CREATE INDEX idx_chat_messages_wa_message_id
    ON chat_messages(wa_message_id, wa_session_id);

-- Enable Row Level Security (Requirement 10.5)
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Authenticated users dapat membaca semua chat_messages
-- (akses dikontrol lebih lanjut via wa_session_id yang hanya dimiliki org mereka)
CREATE POLICY "authenticated_read_chat_messages"
    ON chat_messages FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM wa_sessions ws
            WHERE ws.id = chat_messages.wa_session_id
        )
    );

-- Hanya service role yang bisa insert/update (via Gateway dan API Route)
-- Frontend tidak perlu insert langsung
CREATE POLICY "service_role_write_chat_messages"
    ON chat_messages FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

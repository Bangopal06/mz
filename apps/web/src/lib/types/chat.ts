/**
 * Shared types for the WhatsApp Chat Inbox feature.
 * Requirements: 3.1, 4.1, 5.1, 6.1
 */

export interface ChatMessage {
  id: string;
  wa_session_id: string;
  contact_wa_number: string;
  direction: 'inbound' | 'outbound';
  message_type: 'text' | 'image';
  body: string | null;
  media_url: string | null;
  wa_message_id: string | null;
  status: 'received' | 'sent' | 'delivered' | 'read' | 'failed';
  created_at: string;
}

export interface ConversationSummary {
  contact_wa_number: string;
  contact_name: string | null;
  last_message_body: string | null;
  last_message_type: 'text' | 'image';
  last_message_at: string;
  wa_session_id: string;
}

export interface WaSessionRow {
  id: string;
  session_key: string;
  phone_number: string | null;
  display_name: string | null;
  status: 'connected' | 'disconnected' | 'expired' | 'pairing';
}

export interface SendMessageRequest {
  session_id: string;
  to: string;
  message?: string;
  image_url?: string;
  caption?: string;
}

export interface SendMessageResponse {
  message_id: string;
  status: 'sent';
  chat_message_id: string;
}

export interface SendMessageError {
  error: string;
  error_code?: string;
}

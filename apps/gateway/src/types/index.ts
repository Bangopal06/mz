/**
 * Shared TypeScript types for the WhatsApp Gateway Service.
 */

export type SessionStatus = 'connected' | 'disconnected' | 'expired' | 'pairing';

export interface WaSession {
  id: string;
  session_key: string;
  phone_number?: string;
  display_name?: string;
  status: SessionStatus;
  last_active_at?: string;
}

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface SendMessageRequest {
  session_id: string;
  to: string; // format: 62xxxxxxxxxx
  message: string;
  media?: {
    url: string;
    mime_type: string;
    caption?: string;
  };
}

export interface SendMessageResult {
  to: string;
  status: MessageStatus;
  error_code?: string;
  error_message?: string;
  sent_at?: string;
}

export interface DeliveryCallbackPayload {
  broadcast_id: string;
  contact_wa_number: string;
  status: MessageStatus;
  error_code?: string;
  error_message?: string;
  sent_at?: string;
}

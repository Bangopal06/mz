/**
 * Chat Page — Server Component
 * Loads initial sessions and conversations, then passes to ChatClient.
 * Auth is enforced by middleware; redirect to /login if unauthenticated.
 * Requirements: 3.1, 3.4, 3.5, 9.1, 10.1, 10.2
 */

import { createClient } from '@/src/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { WaSessionRow, ConversationSummary } from '@/src/lib/types/chat';
import ChatClient from './_components/ChatClient';

export default async function ChatPage() {
  const supabase = await createClient();

  // Verify auth — middleware handles redirect, but extra safety check here
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    redirect('/login');
  }

  // Fetch all connected WA sessions (Requirement 9.1)
  const { data: sessions } = await supabase
    .from('wa_sessions')
    .select('id, session_key, phone_number, display_name, status')
    .eq('status', 'connected')
    .order('created_at', { ascending: true });

  const initialSessions: WaSessionRow[] = ((sessions ?? []) as Array<{
    id: string;
    session_key: string;
    phone_number: string | null;
    display_name: string | null;
    status: 'connected' | 'disconnected' | 'expired' | 'pairing';
  }>).map((s) => ({
    id: s.id,
    session_key: s.session_key,
    phone_number: s.phone_number,
    display_name: s.display_name,
    status: s.status,
  }));

  // Fetch initial conversations — latest message per unique contact
  // Join contacts table for name lookup (Requirement 4.1, 4.2)
  const { data: messages } = await supabase
    .from('chat_messages')
    .select(`
      contact_wa_number,
      body,
      message_type,
      created_at,
      wa_session_id
    `)
    .order('created_at', { ascending: false });

  type RawMessage = {
    contact_wa_number: string;
    body: string | null;
    message_type: string;
    created_at: string;
    wa_session_id: string;
  };

  // Build conversation summaries with deduplication by contact_wa_number
  // Then fetch contact names separately
  const seenContacts = new Set<string>();
  const rawConversations: Array<{
    contact_wa_number: string;
    last_message_body: string | null;
    last_message_type: 'text' | 'image';
    last_message_at: string;
    wa_session_id: string;
  }> = [];

  for (const msg of (messages ?? []) as RawMessage[]) {
    if (!seenContacts.has(msg.contact_wa_number)) {
      seenContacts.add(msg.contact_wa_number);
      rawConversations.push({
        contact_wa_number: msg.contact_wa_number,
        last_message_body: msg.body,
        last_message_type: msg.message_type as 'text' | 'image',
        last_message_at: msg.created_at,
        wa_session_id: msg.wa_session_id,
      });
    }
  }

  // Fetch ALL contacts and build name map with flexible number matching
  const { data: allContacts } = await supabase
    .from('contacts')
    .select('wa_number, full_name');

  let contactNameMap = new Map<string, string>();
  for (const c of (allContacts ?? []) as Array<{ wa_number: string; full_name: string }>) {
    const num = c.wa_number.replace(/\D/g, '');
    // Map by full number and by last 10 digits (suffix match)
    contactNameMap.set(num, c.full_name);
    if (num.length > 10) contactNameMap.set(num.slice(-10), c.full_name);
    if (num.startsWith('62')) contactNameMap.set('0' + num.slice(2), c.full_name);
  }

  function lookupName(waNumber: string): string | null {
    const num = waNumber.replace(/\D/g, '');
    return contactNameMap.get(num)
      ?? contactNameMap.get(num.slice(-10))
      ?? contactNameMap.get('0' + num.slice(2))
      ?? null;
  }

  const initialConversations: ConversationSummary[] = rawConversations.map((c) => ({
    contact_wa_number: c.contact_wa_number,
    contact_name: lookupName(c.contact_wa_number),
    last_message_body: c.last_message_body,
    last_message_type: c.last_message_type,
    last_message_at: c.last_message_at,
    wa_session_id: c.wa_session_id,
  }));

  return (
    <ChatClient
      initialSessions={initialSessions}
      initialConversations={initialConversations}
    />
  );
}

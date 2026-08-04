'use client';

/**
 * ChatClient — Root client component for the Chat page.
 * Manages global state and Supabase Realtime subscription.
 * Requirements: 3.1, 8.1, 8.2, 8.3, 8.4, 8.5, 9.3, 9.5
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/src/lib/supabase/client';
import type { ChatMessage, ConversationSummary, WaSessionRow } from '@/src/lib/types/chat';
import InboxPanel from './InboxPanel';
import ChatPanel from './ChatPanel';

interface ChatClientProps {
  initialSessions: WaSessionRow[];
  initialConversations: ConversationSummary[];
}

type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

export default function ChatClient({
  initialSessions,
  initialConversations,
}: ChatClientProps) {
  const [sessions] = useState<WaSessionRow[]>(initialSessions);
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);
  const [selectedContact, setSelectedContact] = useState<ConversationSummary | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    // Auto-select single connected session (Requirement 9.2)
    initialSessions.length === 1 ? initialSessions[0]!.id : null
  );
  // inboxFilterSessionId: null = tampilkan semua sesi di inbox
  const [inboxFilterSessionId, setInboxFilterSessionId] = useState<string | null>(
    initialSessions.length === 1 ? initialSessions[0]!.id : null
  );
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const [newMessage, setNewMessage] = useState<ChatMessage | null>(null);

  // unreadCounts: contact_wa_number → jumlah pesan inbound belum dibaca
  const UNREAD_KEY = 'chat_unread_counts';
  const LAST_READ_KEY = 'chat_last_read';

  // Always start with {} to avoid SSR/hydration mismatch — populated in useEffect
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  // Persist unread counts to localStorage whenever they change (skip initial empty state)
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) return; // skip first render
    try { localStorage.setItem(UNREAD_KEY, JSON.stringify(unreadCounts)); } catch { /* ignore */ }
  }, [unreadCounts]);

  // On mount: recompute unread counts from DB based on last_read timestamps
  useEffect(() => {
    didMountRef.current = true;
    const supabaseClient = createClient();
    let lastRead: Record<string, string> = {};
    try {
      const stored = localStorage.getItem(LAST_READ_KEY);
      lastRead = stored ? (JSON.parse(stored) as Record<string, string>) : {};
    } catch { /* ignore */ }

    supabaseClient
      .from('chat_messages')
      .select('contact_wa_number, created_at')
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data }) => {
        if (!data?.length) return;
        const counts: Record<string, number> = {};
        for (const msg of data as { contact_wa_number: string; created_at: string }[]) {
          const key = msg.contact_wa_number;
          const lastReadAt = lastRead[key];
          if (!lastReadAt || new Date(msg.created_at) > new Date(lastReadAt)) {
            counts[key] = (counts[key] ?? 0) + 1;
          }
        }
        setUnreadCounts(counts);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mobile view state: 'inbox' | 'chat' (Requirement 3.6)
  const [mobileView, setMobileView] = useState<'inbox' | 'chat'>('inbox');

  // Ref to always have the latest selectedContact inside async callbacks
  const selectedContactRef = useRef<ConversationSummary | null>(null);

  const supabase = createClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Connected sessions only
  const connectedSessions = sessions.filter((s) => s.status === 'connected');

  // Fetch contact name from DB for a given wa_number
  const fetchContactName = useCallback(async (waNumber: string): Promise<string | null> => {
    const supabaseClient = createClient();
    const { data } = await supabaseClient
      .from('contacts')
      .select('full_name')
      .eq('wa_number', waNumber)
      .maybeSingle();
    return data?.full_name ?? null;
  }, []);

  // Handle new realtime INSERT event
  const handleNewMessage = useCallback(async (msg: ChatMessage) => {
    setNewMessage(msg);

    // Increment unread count for inbound messages from contacts not currently selected
    if (msg.direction === 'inbound') {
      const currentSelected = selectedContactRef.current;
      const isActive =
        currentSelected?.contact_wa_number === msg.contact_wa_number &&
        currentSelected?.wa_session_id === msg.wa_session_id;
      if (!isActive) {
        setUnreadCounts((prev) => ({
          ...prev,
          [msg.contact_wa_number]: (prev[msg.contact_wa_number] ?? 0) + 1,
        }));
      }
    }

    // Resolve contact name: use existing state first, then DB lookup
    setConversations((prev) => {
      const existingIndex = prev.findIndex(
        (c) =>
          c.contact_wa_number === msg.contact_wa_number &&
          c.wa_session_id === msg.wa_session_id
      );

      const existingName = existingIndex >= 0 ? prev[existingIndex]!.contact_name : null;

      const updatedEntry: ConversationSummary = {
        contact_wa_number: msg.contact_wa_number,
        contact_name: existingName,
        last_message_body: msg.body,
        last_message_type: msg.message_type,
        last_message_at: msg.created_at,
        wa_session_id: msg.wa_session_id,
      };

      let updated: ConversationSummary[];
      if (existingIndex >= 0) {
        updated = [...prev];
        updated.splice(existingIndex, 1);
        updated = [updatedEntry, ...updated];
      } else {
        updated = [updatedEntry, ...prev];
      }

      // If no name yet, fetch from DB asynchronously
      if (!existingName) {
        fetchContactName(msg.contact_wa_number).then((name) => {
          if (name) {
            setConversations((p) =>
              p.map((c) =>
                c.contact_wa_number === msg.contact_wa_number
                  ? { ...c, contact_name: name }
                  : c
              )
            );
          }
        });
      }

      return updated;
    });
  }, [fetchContactName]);

  // Subscribe to Supabase Realtime on mount (Requirement 8.1)
  useEffect(() => {
    const channel = supabase
      .channel('chat_messages_realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        (payload) => {
          const msg = payload.new as ChatMessage;
          void handleNewMessage(msg);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setRealtimeStatus('disconnected');
        } else {
          setRealtimeStatus('connecting');
        }
      });

    channelRef.current = channel;

    // Fallback: poll for new conversations every 10 seconds
    // in case Realtime is not working (table not in publication)
    const pollInterval = setInterval(async () => {
      const supabaseClient = createClient();
      const { data } = await supabaseClient
        .from('chat_messages')
        .select('contact_wa_number, body, message_type, created_at, wa_session_id')
        .order('created_at', { ascending: false })
        .limit(50);

      if (!data?.length) return;

      type RawMsg = { contact_wa_number: string; body: string | null; message_type: string; created_at: string; wa_session_id: string };

      // Rebuild conversations from latest messages
      const seenContacts = new Set<string>();
      const newConvs: ConversationSummary[] = [];
      for (const msg of data as RawMsg[]) {
        if (!seenContacts.has(msg.contact_wa_number)) {
          seenContacts.add(msg.contact_wa_number);
          newConvs.push({
            contact_wa_number: msg.contact_wa_number,
            contact_name: null,
            last_message_body: msg.body,
            last_message_type: msg.message_type as 'text' | 'image',
            last_message_at: msg.created_at,
            wa_session_id: msg.wa_session_id,
          });
        }
      }

      // Merge with existing contact names
      setConversations((prev) => {
        const nameMap = new Map(prev.map(c => [c.contact_wa_number, c.contact_name]));
        const merged = newConvs.map(c => ({ ...c, contact_name: nameMap.get(c.contact_wa_number) ?? null }));

        // Fetch names for contacts that still have no name
        const needsName = merged.filter(c => !c.contact_name);
        if (needsName.length > 0) {
          const numbers = needsName.map(c => c.contact_wa_number);
          supabaseClient
            .from('contacts')
            .select('wa_number, full_name')
            .in('wa_number', numbers)
            .then(({ data: contacts }) => {
              if (!contacts?.length) return;
              const fetchedNames = new Map((contacts as Array<{ wa_number: string; full_name: string }>).map(c => [c.wa_number, c.full_name]));
              setConversations((p) =>
                p.map((c) => fetchedNames.has(c.contact_wa_number) ? { ...c, contact_name: fetchedNames.get(c.contact_wa_number)! } : c)
              );
            });
        }

        return merged;
      });
    }, 5_000);

    // Cleanup on unmount (Requirement 8.4)
    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelectContact(contact: ConversationSummary) {
    setSelectedContact(contact);
    selectedContactRef.current = contact;
    // Auto-switch to the session this conversation belongs to
    setSelectedSessionId(contact.wa_session_id);
    // Clear unread count when opening conversation
    setUnreadCounts((prev) => {
      if (!prev[contact.contact_wa_number]) return prev;
      const next = { ...prev };
      delete next[contact.contact_wa_number];
      return next;
    });
    // Save last_read timestamp so DB-based recompute on next load shows 0 unread
    try {
      const stored = localStorage.getItem('chat_last_read') ?? '{}';
      const lastRead = JSON.parse(stored) as Record<string, string>;
      lastRead[contact.contact_wa_number] = new Date().toISOString();
      localStorage.setItem('chat_last_read', JSON.stringify(lastRead));
    } catch { /* ignore */ }
    // On mobile, switch to chat view
    setMobileView('chat');
    setNewMessage(null);
  }

  function handleSessionChange(sessionId: string) {
    setSelectedSessionId(sessionId);
    setSelectedContact(null);
    selectedContactRef.current = null;
    setMobileView('inbox');
  }

  function handleInboxSessionChange(sessionId: string | null) {
    setInboxFilterSessionId(sessionId);
    // If switching to a specific session, also update selectedSessionId for sending
    if (sessionId !== null) setSelectedSessionId(sessionId);
  }

  function handleBackToInbox() {
    setMobileView('inbox');
  }

  // Filter conversations by inbox session filter (separate from active sending session)
  const filteredConversations = inboxFilterSessionId
    ? conversations.filter((c) => c.wa_session_id === inboxFilterSessionId)
    : conversations;

  return (
    <div className="flex flex-col h-screen">
      {/* Realtime status indicator (Requirement 8.5) */}
      {realtimeStatus === 'disconnected' && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-1.5 text-xs text-yellow-700 text-center">
          Koneksi real-time terputus. Mencoba menghubungkan kembali...
        </div>
      )}

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Inbox panel — left side */}
        {/* Desktop: always visible. Mobile: only when mobileView === 'inbox' */}
        <div
          className={`${
            mobileView === 'inbox' ? 'flex' : 'hidden'
          } lg:flex flex-col w-full lg:w-80 xl:w-96 flex-shrink-0`}
        >
          <InboxPanel
            conversations={filteredConversations}
            activeContact={selectedContact?.contact_wa_number ?? null}
            selectedSessionId={inboxFilterSessionId}
            sessions={sessions}
            unreadCounts={unreadCounts}
            onSelectContact={handleSelectContact}
            onSessionChange={handleInboxSessionChange}
          />
        </div>

        {/* Chat panel — right side */}
        {/* Desktop: always visible. Mobile: only when mobileView === 'chat' */}
        <div
          className={`${
            mobileView === 'chat' ? 'flex' : 'hidden'
          } lg:flex flex-col flex-1 overflow-hidden`}
        >
          <ChatPanel
            contact={selectedContact}
            sessionId={selectedSessionId ?? (connectedSessions[0]?.id ?? null)}
            sessions={sessions}
            onSessionChange={handleSessionChange}
            onBack={handleBackToInbox}
            newIncomingMessage={newMessage}
          />
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/src/lib/supabase/client';
import type { ConversationSummary, WaSessionRow } from '@/src/lib/types/chat';
import { truncatePreview, formatMessageTime } from '@/src/lib/utils/chat-format';

interface InboxPanelProps {
  conversations: ConversationSummary[];
  activeContact: string | null;
  selectedSessionId: string | null;
  sessions: WaSessionRow[];
  onSelectContact: (contact: ConversationSummary) => void;
}

interface ContactRow {
  wa_number: string;
  full_name: string;
}

export default function InboxPanel({
  conversations,
  activeContact,
  selectedSessionId,
  sessions,
  onSelectContact,
}: InboxPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  // Fetch contacts when modal opens
  useEffect(() => {
    if (!showNewChat) return;
    setLoadingContacts(true);
    supabase
      .from('contacts')
      .select('wa_number, full_name')
      .eq('status', 'active')
      .order('full_name', { ascending: true })
      .limit(200)
      .then(({ data }) => {
        setContacts((data ?? []) as ContactRow[]);
        setLoadingContacts(false);
      });
    setTimeout(() => searchRef.current?.focus(), 100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNewChat]);

  function handleStartChat(contact: ContactRow) {
    // Use selected session or first connected session
    const sessionId = selectedSessionId ?? sessions.find(s => s.status === 'connected')?.id ?? sessions[0]?.id ?? '';
    const conv: ConversationSummary = {
      contact_wa_number: contact.wa_number,
      contact_name: contact.full_name,
      last_message_body: null,
      last_message_type: 'text',
      last_message_at: new Date().toISOString(),
      wa_session_id: sessionId,
    };
    setShowNewChat(false);
    setContactSearch('');
    onSelectContact(conv);
  }

  // Filter contacts by search
  const filteredContacts = contactSearch.trim()
    ? contacts.filter(c =>
        c.full_name.toLowerCase().includes(contactSearch.toLowerCase()) ||
        c.wa_number.includes(contactSearch)
      )
    : contacts;

  // Filter inbox by session + search
  const sessionFiltered = selectedSessionId
    ? conversations.filter((c) => c.wa_session_id === selectedSessionId)
    : conversations;

  const filtered = searchQuery.trim()
    ? sessionFiltered.filter((c) => {
        const q = searchQuery.toLowerCase();
        return (
          c.contact_wa_number.toLowerCase().includes(q) ||
          (c.contact_name?.toLowerCase().includes(q) ?? false)
        );
      })
    : sessionFiltered;

  return (
    <>
    <div className="flex flex-col h-full border-r border-gray-200 bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold text-gray-900">Percakapan</h2>
          <button
            onClick={() => setShowNewChat(true)}
            title="Mulai chat baru"
            className="p-1.5 rounded-lg text-gray-500 hover:bg-green-50 hover:text-green-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Cari nama atau nomor..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          <svg
            className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">
            {/* Requirement 4.7 */}
            Tidak ada percakapan ditemukan
          </div>
        ) : (
          <ul>
            {filtered.map((conv) => {
              const isActive = activeContact === conv.contact_wa_number;
              const displayName = conv.contact_name ?? conv.contact_wa_number;
              const preview = truncatePreview(conv.last_message_body, conv.last_message_type);
              const time = formatMessageTime(conv.last_message_at);

              return (
                <li key={`${conv.wa_session_id}-${conv.contact_wa_number}`}>
                  <button
                    onClick={() => onSelectContact(conv)}
                    className={`w-full px-4 py-3 flex items-start gap-3 text-left transition-colors hover:bg-gray-50 ${
                      isActive ? 'bg-green-50 border-l-4 border-green-500' : 'border-l-4 border-transparent'
                    }`}
                  >
                    {/* Avatar */}
                    <div className="flex-shrink-0 w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                      <span className="text-sm font-semibold text-gray-600">
                        {displayName.charAt(0).toUpperCase()}
                      </span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className={`text-sm font-medium truncate ${isActive ? 'text-green-700' : 'text-gray-900'}`}>
                          {displayName}
                        </span>
                        <span className="text-xs text-gray-400 flex-shrink-0">{time}</span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        {/* Camera icon for image messages (Requirement 4.3) */}
                        {conv.last_message_type === 'image' && (
                          <svg
                            className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                          </svg>
                        )}
                        <span className="text-xs text-gray-500 truncate">{preview}</span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>

      {/* Modal Chat Baru */}
      {showNewChat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col max-h-[80vh]">
            {/* Modal header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-base font-semibold text-gray-900">Mulai Chat Baru</h3>
              <button
                onClick={() => { setShowNewChat(false); setContactSearch(''); }}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Search kontak */}
            <div className="px-4 py-3 border-b border-gray-100">
              <input
                ref={searchRef}
                type="text"
                placeholder="Cari nama atau nomor..."
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            {/* Daftar kontak */}
            <div className="flex-1 overflow-y-auto">
              {loadingContacts ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filteredContacts.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-500">
                  {contactSearch ? 'Kontak tidak ditemukan' : 'Tidak ada kontak'}
                </div>
              ) : (
                <ul>
                  {filteredContacts.map((c) => (
                    <li key={c.wa_number}>
                      <button
                        onClick={() => handleStartChat(c)}
                        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex-shrink-0 w-9 h-9 bg-green-100 rounded-full flex items-center justify-center">
                          <span className="text-sm font-semibold text-green-700">
                            {c.full_name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{c.full_name}</p>
                          <p className="text-xs text-gray-500">{c.wa_number}</p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

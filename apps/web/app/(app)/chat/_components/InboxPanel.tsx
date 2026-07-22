'use client';

/**
 * InboxPanel — Left panel showing list of conversations.
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */

import { useState } from 'react';
import type { ConversationSummary } from '@/src/lib/types/chat';
import { truncatePreview, formatMessageTime } from '@/src/lib/utils/chat-format';

interface InboxPanelProps {
  conversations: ConversationSummary[];
  activeContact: string | null;
  selectedSessionId: string | null;
  onSelectContact: (contact: ConversationSummary) => void;
}

export default function InboxPanel({
  conversations,
  activeContact,
  selectedSessionId,
  onSelectContact,
}: InboxPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter by session if selected
  const sessionFiltered = selectedSessionId
    ? conversations.filter((c) => c.wa_session_id === selectedSessionId)
    : conversations;

  // Filter by search query — case-insensitive on name or number (Property 9)
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
    <div className="flex flex-col h-full border-r border-gray-200 bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900 mb-2">Percakapan</h2>
        {/* Search input (Requirement 4.6) */}
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
  );
}

'use client';

/**
 * ChatPanel — Right panel showing message history and send input.
 * Requirements: 3.1, 3.3, 3.4, 5.1-5.7, 6.1-6.8, 7.1-7.4, 9.1, 9.2
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/src/lib/supabase/client';
import type { ChatMessage, ConversationSummary, WaSessionRow } from '@/src/lib/types/chat';
import { formatMessageTime, validateImageFile } from '@/src/lib/utils/chat-format';

interface ChatPanelProps {
  contact: ConversationSummary | null;
  sessionId: string | null;
  sessions: WaSessionRow[];
  onSessionChange: (sessionId: string) => void;
  onBack?: () => void;
  newIncomingMessage?: ChatMessage | null;
}

const PAGE_SIZE = 50;

export default function ChatPanel({
  contact,
  sessionId,
  sessions,
  onSessionChange,
  onBack,
  newIncomingMessage,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevContactRef = useRef<string | null>(null);

  // Connected sessions only (Property 20)
  const connectedSessions = sessions.filter((s) => s.status === 'connected');
  const hasActiveSessions = connectedSessions.length > 0;

  const supabase = createClient();

  // Load messages when contact changes
  useEffect(() => {
    if (!contact) {
      setMessages([]);
      setOffset(0);
      setHasMore(false);
      return;
    }

    if (prevContactRef.current !== contact.contact_wa_number) {
      prevContactRef.current = contact.contact_wa_number;
      setMessages([]);
      setOffset(0);
      loadMessages(contact.wa_session_id, contact.contact_wa_number, 0, true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact]);

  // Handle new incoming realtime message (from ChatClient)
  useEffect(() => {
    if (!newIncomingMessage) return;
    if (!contact) return;
    if (
      newIncomingMessage.contact_wa_number === contact.contact_wa_number &&
      newIncomingMessage.wa_session_id === contact.wa_session_id
    ) {
      setMessages((prev) => {
        // Avoid exact id duplicates
        if (prev.some((m) => m.id === newIncomingMessage.id)) return prev;

        // For outbound messages, replace the matching optimistic entry instead of appending
        if (newIncomingMessage.direction === 'outbound') {
          const optimisticIndex = prev.findIndex(
            (m) =>
              m.id.startsWith('optimistic-') &&
              m.direction === 'outbound' &&
              m.body === newIncomingMessage.body &&
              m.message_type === newIncomingMessage.message_type
          );
          if (optimisticIndex !== -1) {
            const updated = [...prev];
            updated[optimisticIndex] = newIncomingMessage;
            return updated;
          }
        }

        return [...prev, newIncomingMessage];
      });
      setTimeout(scrollToBottom, 50);
    }
  }, [newIncomingMessage, contact]);

  async function loadMessages(
    waSessionId: string,
    contactNumber: string,
    currentOffset: number,
    isInitial: boolean
  ) {
    if (isInitial) setLoading(true);
    else setLoadingMore(true);

    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('wa_session_id', waSessionId)
      .eq('contact_wa_number', contactNumber)
      .order('created_at', { ascending: false })
      .range(currentOffset, currentOffset + PAGE_SIZE - 1);

    const fetched = (data ?? []) as ChatMessage[];

    // Reverse to show oldest at top (Property 10)
    const sorted = [...fetched].reverse();

    if (isInitial) {
      setMessages(sorted);
      setOffset(fetched.length);
      setHasMore(fetched.length === PAGE_SIZE);
      setLoading(false);
      setTimeout(scrollToBottom, 50);
    } else {
      // Prepend older messages
      setMessages((prev) => [...sorted, ...prev]);
      setOffset((prev) => prev + fetched.length);
      setHasMore(fetched.length === PAGE_SIZE);
      setLoadingMore(false);
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Infinite scroll upward — load more when near the top
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container || loadingMore || !hasMore || !contact) return;

    if (container.scrollTop < 100) {
      const prevScrollHeight = container.scrollHeight;
      loadMessages(contact.wa_session_id, contact.contact_wa_number, offset, false).then(() => {
        // Maintain scroll position after prepending
        const newScrollHeight = container.scrollHeight;
        container.scrollTop = newScrollHeight - prevScrollHeight;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMore, hasMore, contact, offset]);

  // File selection handler
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateImageFile(file);
    if (!validation.valid) {
      setFileError(validation.error ?? 'File tidak valid');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setFilePreviewUrl(url);
  }

  function clearFileSelection() {
    setSelectedFile(null);
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    setFilePreviewUrl(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Send message handler
  async function handleSend() {
    if (!contact) return;
    if (!inputText.trim() && !selectedFile) return;

    // Use the contact's session if no session explicitly selected
    const effectiveSessionId = sessionId ?? contact.wa_session_id;

    if (!effectiveSessionId) {
      setSendError('Tidak ada sesi WhatsApp aktif');
      return;
    }

    if (!hasActiveSessions) {
      setSendError('Sesi WhatsApp tidak terhubung');
      return;
    }

    setSending(true);
    setSendError(null);

    try {
      let imageUrl: string | null = null;

      // Upload image first if selected (Property 17: upload before Gateway request)
      if (selectedFile) {
        const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL']!;
        const timestamp = Date.now();
        const ext = selectedFile.type === 'image/png' ? 'png' : 'jpg';
        const filePath = `${effectiveSessionId}/${contact.contact_wa_number}/${timestamp}_${selectedFile.name}.${ext}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('chat-media')
          .upload(filePath, selectedFile, {
            contentType: selectedFile.type,
            upsert: false,
          });

        if (uploadError || !uploadData) {
          setSendError('Gagal mengunggah gambar. Silakan coba lagi.');
          setSending(false);
          return;
        }

        imageUrl = `${supabaseUrl}/storage/v1/object/public/chat-media/${uploadData.path}`;
      }

      const payload: Record<string, string> = {
        session_id: effectiveSessionId,
        to: contact.contact_wa_number,
      };

      if (imageUrl) {
        payload['image_url'] = imageUrl;
        if (inputText.trim()) payload['caption'] = inputText.trim();
      } else {
        payload['message'] = inputText.trim();
      }

      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Gagal mengirim pesan' }));
        const errMsg = errorData.error ?? 'Gagal mengirim pesan';
        setSendError(errMsg);
      } else {
        const sentText = inputText.trim();
        const sentImageUrl = imageUrl;

        setInputText('');
        clearFileSelection();
        setSendError(null);

        // Optimistically add message to state so it appears immediately
        const optimisticMsg: ChatMessage = {
          id: `optimistic-${Date.now()}`,
          wa_session_id: effectiveSessionId,
          contact_wa_number: contact.contact_wa_number,
          direction: 'outbound',
          message_type: sentImageUrl ? 'image' : 'text',
          body: sentImageUrl ? (sentText || null) : sentText,
          media_url: sentImageUrl,
          wa_message_id: null,
          status: 'sent',
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimisticMsg]);
        setTimeout(scrollToBottom, 50);
      }
    } catch {
      setSendError('Terjadi kesalahan saat mengirim pesan');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Empty state — no contact selected
  if (!contact) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h3 className="text-gray-600 font-medium">Pilih percakapan</h3>
          <p className="text-sm text-gray-400 mt-1">Pilih kontak dari daftar di sebelah kiri</p>
        </div>
      </div>
    );
  }

  const displayName = contact.contact_name ?? contact.contact_wa_number;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white">
        {/* Back button for mobile (Requirement 3.6) */}
        {onBack && (
          <button
            onClick={onBack}
            className="lg:hidden p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
            aria-label="Kembali"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Contact info (Requirement 5.7) */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">{displayName}</h3>
          <p className="text-xs text-gray-500">{contact.contact_wa_number}</p>
        </div>

        {/* Session selector dropdown (Requirement 6.8, 9.1, 9.2) */}
        <div className="flex-shrink-0">
          {connectedSessions.length === 0 ? (
            <span className="text-xs text-red-500 font-medium">Tidak ada sesi aktif</span>
          ) : (
            <select
              value={sessionId ?? ''}
              onChange={(e) => onSessionChange(e.target.value)}
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
            >
              {connectedSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name ?? s.session_key} {s.phone_number ? `(${s.phone_number})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-gray-50"
      >
        {/* Load more indicator */}
        {loadingMore && (
          <div className="text-center py-2">
            <span className="text-xs text-gray-400">Memuat pesan lama...</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-gray-400">Belum ada pesan dalam percakapan ini</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOutbound = msg.direction === 'outbound';
            return (
              <div
                key={msg.id}
                className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-xs lg:max-w-md xl:max-w-lg rounded-2xl px-4 py-2 shadow-sm ${
                    isOutbound
                      ? 'bg-green-500 text-white rounded-br-sm'
                      : 'bg-white text-gray-900 rounded-bl-sm border border-gray-100'
                  }`}
                >
                  {/* Image bubble (Requirement 5.4) */}
                  {msg.message_type === 'image' && msg.media_url && (
                    <button
                      onClick={() => setLightboxUrl(msg.media_url!)}
                      className="block mb-1 rounded-lg overflow-hidden"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={msg.media_url}
                        alt="Media"
                        className="max-w-full max-h-48 object-cover rounded-lg"
                      />
                    </button>
                  )}

                  {/* Text body */}
                  {msg.body && (
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                  )}

                  {/* Time + status (Requirements 5.3, 5.8) */}
                  <div className={`flex items-center gap-1 mt-1 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                    <span className={`text-xs ${isOutbound ? 'text-green-100' : 'text-gray-400'}`}>
                      {formatMessageTime(msg.created_at)}
                    </span>
                    {isOutbound && (
                      <StatusIndicator status={msg.status} />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Send area */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        {/* No active session warning (Requirements 6.7, 9.4) */}
        {!hasActiveSessions && (
          <div className="mb-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-xs text-yellow-700">Tidak ada sesi WhatsApp yang terhubung. Pesan tidak dapat dikirim.</p>
          </div>
        )}

        {/* Send error */}
        {sendError && (
          <div className="mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-xs text-red-600">{sendError}</p>
          </div>
        )}

        {/* File error */}
        {fileError && (
          <div className="mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-xs text-red-600">{fileError}</p>
          </div>
        )}

        {/* Image preview (Requirement 7.4) */}
        {filePreviewUrl && (
          <div className="mb-2 relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={filePreviewUrl}
              alt="Preview"
              className="h-20 w-20 object-cover rounded-lg border border-gray-200"
            />
            <button
              onClick={clearFileSelection}
              className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs leading-none"
              aria-label="Hapus lampiran"
            >
              ×
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Attachment button (Requirement 7.1) */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleFileSelect}
            className="hidden"
            disabled={!hasActiveSessions}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!hasActiveSessions}
            className="p-2 text-gray-400 hover:text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            aria-label="Lampirkan gambar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          {/* Text input (Requirement 6.1) */}
          <textarea
            value={inputText}
            onChange={(e) => { setInputText(e.target.value); if (sendError) setSendError(null); }}
            onKeyDown={handleKeyDown}
            disabled={!hasActiveSessions || sending}
            placeholder={hasActiveSessions ? 'Ketik pesan...' : 'Tidak ada sesi aktif'}
            rows={1}
            className="flex-1 resize-none border border-gray-300 rounded-2xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-50 disabled:cursor-not-allowed max-h-32 overflow-y-auto"
            style={{ minHeight: '40px' }}
          />

          {/* Send button (Requirement 6.1, 6.2) */}
          <button
            onClick={handleSend}
            disabled={!hasActiveSessions || sending || (!inputText.trim() && !selectedFile)}
            className="p-2 bg-green-500 text-white rounded-full hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 transition-colors"
            aria-label="Kirim pesan"
          >
            {sending ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Lightbox (Requirement 5.4) */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Full size"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 text-white p-2 rounded-full bg-black/50 hover:bg-black/70"
            aria-label="Tutup"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

/** Status indicator for outbound messages (Requirement 5.8) */
function StatusIndicator({ status }: { status: ChatMessage['status'] }) {
  if (status === 'sent') {
    return (
      <svg className="w-3 h-3 text-green-100" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
      </svg>
    );
  }
  if (status === 'delivered') {
    return (
      <svg className="w-4 h-3.5 text-green-100" fill="currentColor" viewBox="0 0 24 14">
        <path d="M1 7l5 5L17 1M7 7l5 5L23 1" stroke="currentColor" strokeWidth="2" fill="none" />
      </svg>
    );
  }
  if (status === 'read') {
    return (
      <svg className="w-4 h-3.5 text-blue-200" fill="currentColor" viewBox="0 0 24 14">
        <path d="M1 7l5 5L17 1M7 7l5 5L23 1" stroke="currentColor" strokeWidth="2" fill="none" />
      </svg>
    );
  }
  if (status === 'failed') {
    return (
      <svg className="w-3 h-3 text-red-300" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
    );
  }
  return null;
}

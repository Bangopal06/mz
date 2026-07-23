/**
 * Auto-reply handler: processes incoming WhatsApp messages,
 * matches against keyword rules from Supabase, and sends responses.
 * Runs entirely in the gateway to avoid Supabase Edge Function localhost limitation.
 */

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

interface KeywordTrigger {
  keyword: string;
}

interface KeywordRule {
  id: string;
  response_text: string;
  is_greeting: boolean;
  keyword_triggers: KeywordTrigger[];
}

function supabaseHeaders(key: string) {
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

/**
 * Normalizes a WA number to the international format 62xxxxxxxxxx.
 * Strips all non-digit characters and replaces leading 0 with 62.
 */
function normalizeWaNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (digits.startsWith('62')) return digits;
  return '62' + digits;
}

/**
 * Saves an inbound chat message to the chat_messages table in Supabase.
 * Uses ON CONFLICT DO NOTHING on (wa_session_id, wa_message_id) for idempotency.
 * Requirements: 2.1, 2.4, 2.6, 1.4, 1.5
 */
export async function saveChatMessage(
  cfg: SupabaseConfig,
  sessionDbId: string,
  waNumber: string,
  messageId: string,
  messageText: string | null,
  messageType: 'text' | 'image',
  mediaUrl: string | null,
  direction: 'inbound' | 'outbound' = 'inbound'
): Promise<void> {
  const normalizedNumber = normalizeWaNumber(waNumber);

  const payload = {
    wa_session_id: sessionDbId,
    contact_wa_number: normalizedNumber,
    direction,
    message_type: messageType,
    body: messageText,
    media_url: mediaUrl,
    wa_message_id: messageId,
    status: direction === 'outbound' ? 'sent' : 'received',
  };

  const res = await fetch(`${cfg.url}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(cfg.serviceRoleKey),
      Prefer: 'return=minimal,resolution=ignore-duplicates',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to save chat message: ${res.status} ${text}`);
  }
}

/**
 * Uploads a media buffer to Supabase Storage bucket chat-media.
 * Returns the public URL of the uploaded file, or null on failure.
 * Requirement: 2.5
 */
export async function saveMediaToStorage(
  cfg: SupabaseConfig,
  sessionDbId: string,
  waNumber: string,
  messageId: string,
  mediaBuffer: Buffer,
  mimeType: string
): Promise<string | null> {
  try {
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    const timestamp = Date.now();
    const normalizedNumber = normalizeWaNumber(waNumber);
    const filePath = `${sessionDbId}/${normalizedNumber}/${timestamp}_${messageId}.${ext}`;

    const uploadRes = await fetch(
      `${cfg.url}/storage/v1/object/chat-media/${filePath}`,
      {
        method: 'POST',
        headers: {
          apikey: cfg.serviceRoleKey,
          Authorization: `Bearer ${cfg.serviceRoleKey}`,
          'Content-Type': mimeType,
          'x-upsert': 'false',
        },
        body: mediaBuffer,
      }
    );

    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => '');
      console.warn(`[AutoReply] Failed to upload media to Storage: ${uploadRes.status} ${text}`);
      return null;
    }

    return `${cfg.url}/storage/v1/object/public/chat-media/${filePath}`;
  } catch (err) {
    console.error('[AutoReply] Error uploading media to Storage:', err);
    return null;
  }
}

/**
 * Handles an incoming message: saves to chat_messages BEFORE auto-reply, then processes keyword rules.
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */
export async function handleIncomingMessage(
  cfg: SupabaseConfig,
  _gatewayUrl: string,
  _gatewayApiKey: string,
  sessionKey: string,
  from: string,
  messageText: string,
  sendMessage: (to: string, text: string) => Promise<void>,
  sessionDbId?: string,
  rawMessage?: unknown
): Promise<void> {
  // Extract clean number: strip @s.whatsapp.net, juga handle format multi-device "number:deviceId@..."
  const rawNumber = from.split('@')[0]?.split(':')[0] ?? '';
  const waNumber = rawNumber.replace(/[^0-9]/g, '');

  // Skip messages from groups
  if (!waNumber || from.endsWith('@g.us')) return;

  // Skip @lid JIDs — these are Facebook internal IDs, not phone numbers
  if (from.endsWith('@lid')) return;

  // Skip messages from self (outgoing)
  if (from.includes(':')) return;

  // Save inbound message to chat_messages BEFORE auto-reply (Requirement 2.1)
  // Resolve sessionDbId: use provided dbId, or fetch from DB by session_key
  let resolvedDbId = sessionDbId;
  if (!resolvedDbId) {
    try {
      const res = await fetch(
        `${cfg.url}/rest/v1/wa_sessions?session_key=eq.${encodeURIComponent(sessionKey)}&select=id&limit=1`,
        { headers: { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}` } }
      );
      if (res.ok) {
        const rows = await res.json() as { id: string }[];
        resolvedDbId = rows[0]?.id;
        if (resolvedDbId) {
          console.info(`[AutoReply] Resolved dbId for session ${sessionKey}: ${resolvedDbId}`);
        }
      }
    } catch (err) {
      console.warn('[AutoReply] Could not resolve sessionDbId from DB:', err);
    }
  }

  console.info(`[AutoReply] handleIncomingMessage from=${from} waNumber=${waNumber} sessionKey=${sessionKey} resolvedDbId=${resolvedDbId}`);

  if (resolvedDbId) {
    try {
      const rawMsg = rawMessage as { key?: { id?: string }; message?: { imageMessage?: { mimetype?: string } } } | undefined;
      const messageId = rawMsg?.key?.id ?? `${Date.now()}-${waNumber}`;
      const imageMsg = rawMsg?.message?.imageMessage;

      let messageType: 'text' | 'image' = 'text';
      let mediaUrl: string | null = null;
      let bodyText: string | null = messageText || null;

      if (imageMsg) {
        messageType = 'image';
        bodyText = null;
      }

      await saveChatMessage(cfg, resolvedDbId, waNumber, messageId, bodyText, messageType, mediaUrl);
    } catch (err) {
      console.error('[AutoReply] Failed to save chat message, continuing with auto-reply:', err);
    }
  } else {
    console.warn(`[AutoReply] No sessionDbId for session ${sessionKey}, message not saved to DB`);
  }

  // Auto-reply logic
  try {
    if (!messageText?.trim()) return;

    const rulesRes = await fetch(
      `${cfg.url}/rest/v1/keyword_rules?is_active=eq.true&select=id,response_text,is_greeting,keyword_triggers(keyword)`,
      { headers: supabaseHeaders(cfg.serviceRoleKey) }
    );
    if (!rulesRes.ok) return;

    const rules: KeywordRule[] = (await rulesRes.json()) as KeywordRule[];
    if (!rules.length) return;

    const normalizedMsg = messageText.toLowerCase().trim();

    let matchedRule: KeywordRule | null = null;
    for (const rule of rules) {
      const hit = rule.keyword_triggers.some(
        (t) => normalizedMsg.includes(t.keyword.toLowerCase())
      );
      if (hit) { matchedRule = rule; break; }
    }

    if (!matchedRule) return;

    // Greeting guard: only send once per contact per session
    if (matchedRule.is_greeting) {
      const greetedRes = await fetch(
        `${cfg.url}/rest/v1/greeted_contacts?contact_wa_number=eq.${encodeURIComponent(waNumber)}&select=contact_wa_number&limit=1`,
        { headers: supabaseHeaders(cfg.serviceRoleKey) }
      );
      if (greetedRes.ok) {
        const greeted = (await greetedRes.json()) as { contact_wa_number: string }[];
        if (greeted.length > 0) return;
      }

      await fetch(`${cfg.url}/rest/v1/greeted_contacts`, {
        method: 'POST',
        headers: { ...supabaseHeaders(cfg.serviceRoleKey), Prefer: 'return=minimal' },
        body: JSON.stringify({ contact_wa_number: waNumber, session_id: null }),
      }).catch(() => {});
    }

    await sendMessage(waNumber, matchedRule.response_text);

    await fetch(`${cfg.url}/rest/v1/activity_logs`, {
      method: 'POST',
      headers: { ...supabaseHeaders(cfg.serviceRoleKey), Prefer: 'return=minimal' },
      body: JSON.stringify({
        action: 'auto_reply.sent',
        entity_type: 'keyword_rule',
        entity_id: matchedRule.id,
        detail: { wa_number: waNumber, session_key: sessionKey, keyword_rule_id: matchedRule.id },
      }),
    }).catch(() => {});

    console.info(`[AutoReply] Replied to ${waNumber} with rule ${matchedRule.id}`);
  } catch (err) {
    console.error('[AutoReply] Error handling incoming message:', err);
  }
}

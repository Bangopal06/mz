/**
 * Syncs WhatsApp contacts from Baileys to Supabase contacts table.
 * Runs once when a session connects.
 */

import type { WASocket } from '@whiskeysockets/baileys';

interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

function supabaseHeaders(key: string) {
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

function formatNumber(jid: string): string {
  // Strip @s.whatsapp.net and non-digit characters
  const num = jid.split('@')[0]?.replace(/[^0-9]/g, '') ?? '';
  // Normalize: leading 0 → 62 (Indonesian)
  if (num.startsWith('0')) return '62' + num.slice(1);
  return num;
}

function isValidNumber(num: string): boolean {
  // Must be 8-20 digits, typically starts with country code
  return /^\d{8,20}$/.test(num);
}

/**
 * Fetch contacts from WA, upsert to Supabase.
 * Marks contacts as source='wa_sync' and stores source_session_id
 * so they can be cascade-deleted when the session is removed.
 */
export async function syncContacts(
  socket: WASocket,
  cfg: SupabaseConfig,
  sessionDbId: string
): Promise<void> {
  try {
    console.info('[ContactSync] Starting contact sync...');

    // Baileys stores contacts in the auth state store
    // We can get them from socket.store if available, or from contacts event
    const rawContacts = Object.values(socket.store?.contacts ?? {}) as {
      id: string;
      name?: string;
      notify?: string;
    }[];

    if (!rawContacts.length) {
      console.info('[ContactSync] No contacts found in store, waiting for contacts.upsert event...');
      return;
    }

    const toInsert: { full_name: string; wa_number: string; source: string; source_session_id: string }[] = [];

    for (const c of rawContacts) {
      if (!c.id || c.id.includes('@g.us')) continue; // skip groups
      if (c.id.includes('@lid')) continue; // skip Facebook internal IDs
      const num = formatNumber(c.id);
      if (!isValidNumber(num)) continue;
      const name = c.name ?? c.notify ?? num;
      toInsert.push({ full_name: name, wa_number: num, source: 'wa_sync', source_session_id: sessionDbId });
    }

    if (!toInsert.length) {
      console.info('[ContactSync] No valid contacts to sync');
      return;
    }

    console.info(`[ContactSync] Syncing ${toInsert.length} contacts...`);

    // Batch upsert in chunks of 100
    // Use merge-duplicates so source/source_session_id gets updated if contact already exists
    const chunkSize = 100;
    let synced = 0;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      const res = await fetch(`${cfg.url}/rest/v1/contacts`, {
        method: 'POST',
        headers: {
          ...supabaseHeaders(cfg.serviceRoleKey),
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(chunk),
      });
      if (res.ok) synced += chunk.length;
      else {
        const err = await res.text();
        console.warn(`[ContactSync] Chunk upsert failed: ${res.status} ${err}`);
      }
    }

    console.info(`[ContactSync] Synced ${synced} contacts`);
  } catch (err) {
    console.error('[ContactSync] Error:', err);
  }
}

/**
 * Listen to ALL contact sync events from WA:
 * - contacts.set     : full contact list sent by WA on first connect (most complete)
 * - contacts.upsert  : incremental updates / additional batches
 * - contacts.update  : name/info changes
 */
export function watchContactsUpsert(
  socket: WASocket,
  cfg: SupabaseConfig,
  sessionDbId: string
): void {

  async function upsertContacts(contacts: { id: string; name?: string; notify?: string; verifiedName?: string }[]) {
    const toInsert: { full_name: string; wa_number: string; source: string; source_session_id: string }[] = [];

    for (const c of contacts) {
      if (!c.id) continue;
      // Skip groups and broadcasts
      if (c.id.includes('@g.us') || c.id.includes('@broadcast')) continue;
      // Skip @lid contacts — these are Facebook internal IDs, not phone numbers
      if (c.id.includes('@lid')) continue;
      const num = formatNumber(c.id);
      if (!isValidNumber(num)) continue;
      const name = c.name ?? c.notify ?? c.verifiedName ?? num;
      toInsert.push({ full_name: name, wa_number: num, source: 'wa_sync', source_session_id: sessionDbId });
    }

    if (!toInsert.length) return 0;

    const chunkSize = 200;
    let synced = 0;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      const res = await fetch(`${cfg.url}/rest/v1/contacts`, {
        method: 'POST',
        headers: {
          ...supabaseHeaders(cfg.serviceRoleKey),
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(chunk),
      }).catch(() => null);
      if (res?.ok) synced += chunk.length;
    }
    return synced;
  }

  // contacts.set fires with the FULL contact list on first connect
  socket.ev.on('contacts.set', async ({ contacts }) => {
    console.info(`[ContactSync] contacts.set: received ${contacts.length} contacts (full sync)`);
    const synced = await upsertContacts(contacts as { id: string; name?: string; notify?: string; verifiedName?: string }[]);
    console.info(`[ContactSync] contacts.set: synced ${synced} contacts`);
  });

  // contacts.upsert fires for incremental batches
  socket.ev.on('contacts.upsert', async (contacts) => {
    console.info(`[ContactSync] contacts.upsert: syncing ${contacts.length} contacts`);
    await upsertContacts(contacts as { id: string; name?: string; notify?: string; verifiedName?: string }[]);
  });

  // contacts.update fires when a contact's name/info changes
  socket.ev.on('contacts.update', async (updates) => {
    const contacts = updates.filter((u) => u.notify || u.name);
    if (contacts.length) {
      await upsertContacts(contacts as { id: string; name?: string; notify?: string; verifiedName?: string }[]);
    }
  });
}

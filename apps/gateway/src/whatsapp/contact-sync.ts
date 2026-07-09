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
  // Strip @s.whatsapp.net and ensure starts with 62 or keep as-is
  const num = jid.split('@')[0]?.replace(/[^0-9]/g, '') ?? '';
  return num;
}

function isValidNumber(num: string): boolean {
  // Must be 10-15 digits, typically starts with country code
  return /^\d{10,15}$/.test(num);
}

/**
 * Fetch contacts from WA, upsert to Supabase.
 * Uses ON CONFLICT DO NOTHING so existing contacts are not overwritten.
 */
export async function syncContacts(
  socket: WASocket,
  cfg: SupabaseConfig
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

    const toInsert: { full_name: string; wa_number: string }[] = [];

    for (const c of rawContacts) {
      if (!c.id || c.id.includes('@g.us')) continue; // skip groups
      const num = formatNumber(c.id);
      if (!isValidNumber(num)) continue;
      const name = c.name ?? c.notify ?? num;
      toInsert.push({ full_name: name, wa_number: num });
    }

    if (!toInsert.length) {
      console.info('[ContactSync] No valid contacts to sync');
      return;
    }

    console.info(`[ContactSync] Syncing ${toInsert.length} contacts...`);

    // Batch upsert in chunks of 100
    const chunkSize = 100;
    let synced = 0;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      const res = await fetch(`${cfg.url}/rest/v1/contacts`, {
        method: 'POST',
        headers: {
          ...supabaseHeaders(cfg.serviceRoleKey),
          Prefer: 'resolution=ignore-duplicates,return=minimal',
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
 * Listen to contacts.upsert event and sync new/updated contacts.
 * This fires when WA sends the full contact list after connection.
 */
export function watchContactsUpsert(
  socket: WASocket,
  cfg: SupabaseConfig
): void {
  socket.ev.on('contacts.upsert', async (contacts) => {
    const toInsert: { full_name: string; wa_number: string }[] = [];

    for (const c of contacts) {
      if (!c.id || c.id.includes('@g.us')) continue;
      const num = formatNumber(c.id);
      if (!isValidNumber(num)) continue;
      const name = (c as { name?: string; notify?: string }).name
        ?? (c as { name?: string; notify?: string }).notify
        ?? num;
      toInsert.push({ full_name: name, wa_number: num });
    }

    if (!toInsert.length) return;

    console.info(`[ContactSync] contacts.upsert: syncing ${toInsert.length} contacts`);

    const chunkSize = 100;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      await fetch(`${cfg.url}/rest/v1/contacts`, {
        method: 'POST',
        headers: {
          ...supabaseHeaders(cfg.serviceRoleKey),
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify(chunk),
      }).catch(() => {});
    }
  });
}

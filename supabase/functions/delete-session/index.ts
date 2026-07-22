import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { session_id } = await req.json() as { session_id: string };

    if (!session_id) {
      return new Response(
        JSON.stringify({ error: 'session_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Count wa_sync contacts that will be deleted
    const { count: contactCount, error: countErr } = await supabase
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('source', 'wa_sync')
      .eq('source_session_id', session_id);

    if (countErr) {
      console.error('[delete-session] Count error:', countErr);
    }

    // 2. Delete wa_sync contacts belonging to this session
    const { error: deleteContactsErr } = await supabase
      .from('contacts')
      .delete()
      .eq('source', 'wa_sync')
      .eq('source_session_id', session_id);

    if (deleteContactsErr) {
      return new Response(
        JSON.stringify({ error: 'Failed to delete contacts', detail: deleteContactsErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Delete the session record
    const { error: deleteSessionErr } = await supabase
      .from('wa_sessions')
      .delete()
      .eq('id', session_id);

    if (deleteSessionErr) {
      return new Response(
        JSON.stringify({ error: 'Failed to delete session', detail: deleteSessionErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, deleted_contacts_count: contactCount ?? 0 }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[delete-session] Unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

import { createClient } from '@/src/lib/supabase/server';
import AutoReplyClient from './_components/AutoReplyClient';

export default async function AutoReplyPage() {
  const supabase = await createClient();

  const { data: rules } = await supabase
    .from('keyword_rules')
    .select('id, name, response_text, is_active, is_greeting, created_at')
    .order('created_at', { ascending: false });

  // Get triggers per rule
  const rulesWithTriggers = await Promise.all(
    (rules ?? []).map(async (r) => {
      const { data: triggers } = await supabase
        .from('keyword_triggers')
        .select('id, keyword')
        .eq('rule_id', r.id);
      return { ...r, triggers: triggers ?? [] };
    })
  );

  return <AutoReplyClient initialRules={rulesWithTriggers} />;
}

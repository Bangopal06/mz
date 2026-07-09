export interface KeywordRuleWithTriggers {
  id: string;
  name: string;
  response_text: string;
  is_active: boolean;
  is_greeting: boolean;
  keywords: string[];
}

export function matchKeyword(
  message: string,
  rules: KeywordRuleWithTriggers[]
): KeywordRuleWithTriggers | null {
  const lower = message.toLowerCase();
  for (const rule of rules) {
    if (!rule.is_active) continue;
    for (const kw of rule.keywords) {
      if (lower.includes(kw.toLowerCase())) return rule;
    }
  }
  return null;
}

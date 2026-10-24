export interface RedactionFinding {
  type: string;
  count: number;
}

const RULES: { type: string; re: RegExp; keepPrefix?: number }[] = [
  { type: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { type: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, keepPrefix: 7 },
  { type: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, keepPrefix: 3 },
  { type: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, keepPrefix: 4 },
  { type: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, keepPrefix: 4 },
  { type: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, keepPrefix: 5 },
  { type: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, keepPrefix: 4 },
  { type: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { type: 'bearer-token', re: /(\bBearer\s+)[A-Za-z0-9._~+/=-]{20,}/g },
  { type: 'url-credentials', re: /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi },
  {
    type: 'secret-assignment',
    re: /(\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|ACCESS_KEY)[A-Z0-9_]*\s*[=:]\s*["']?)[^\s"']{8,}/g,
  },
];

/** Mask likely credentials. Returns the cleaned text plus a count per secret type. */
export function redact(text: string): { text: string; findings: RedactionFinding[] } {
  const counts = new Map<string, number>();
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, (match: string, ...groups: unknown[]) => {
      counts.set(rule.type, (counts.get(rule.type) ?? 0) + 1);
      const captures = groups.slice(0, -2).filter((g): g is string => typeof g === 'string');
      if (rule.type === 'url-credentials') return `${captures[0]}[REDACTED]${captures[1]}`;
      if (captures.length > 0) return `${captures[0]}[REDACTED]`;
      if (rule.keepPrefix) return `${match.slice(0, rule.keepPrefix)}[REDACTED]`;
      return `[REDACTED:${rule.type}]`;
    });
  }
  return { text: out, findings: [...counts].map(([type, count]) => ({ type, count })) };
}

export function mergeFindings(...lists: RedactionFinding[][]): RedactionFinding[] {
  const m = new Map<string, number>();
  for (const f of lists.flat()) m.set(f.type, (m.get(f.type) ?? 0) + f.count);
  return [...m].map(([type, count]) => ({ type, count }));
}

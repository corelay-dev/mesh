export const BANNED_TERMS = [
  "kill", "destroy them", "wipe out", "blood will flow", "die",
  "infidel", "kafir", "omo ale", "bastard", "ode", "oloshi",
];

export const ELECTORAL_VIOLATIONS = [
  { pattern: /vote\s+buying/i, note: "References vote buying — illegal under Electoral Act 2022" },
  { pattern: /free\s+money.*poll/i, note: "Implies inducement near polling — Electoral Act S121" },
  { pattern: /inec\s+is\s+(corrupt|rigged|useless)/i, note: "Delegitimizing INEC may violate Electoral Act S92" },
  { pattern: /we\s+will\s+(rig|manipulate|steal)/i, note: "Implies electoral fraud — Criminal Code" },
  { pattern: /if\s+you\s+don'?t\s+vote.*suffer/i, note: "Voter intimidation — Electoral Act S127" },
];

export interface ComplianceResult {
  passed: boolean;
  notes: string;
  issues: string[];
}

export function runStaticChecks(content: string, campaignDonts: string[]): string[] {
  const issues: string[] = [];
  const lower = content.toLowerCase();

  for (const term of BANNED_TERMS) {
    if (lower.includes(term)) {
      issues.push(`Hate speech / incitement detected: "${term}"`);
    }
  }

  for (const { pattern, note } of ELECTORAL_VIOLATIONS) {
    if (pattern.test(content)) {
      issues.push(note);
    }
  }

  for (const dont of campaignDonts) {
    const keywords = dont.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    const matched = keywords.filter((k) => lower.includes(k));
    if (matched.length >= 2) {
      issues.push(`Violates campaign rule: "${dont}"`);
    }
  }

  return issues;
}

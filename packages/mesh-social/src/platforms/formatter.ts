export interface PlatformConstraint {
  maxChars: number;
  maxHashtags: number;
  aspectRatio: string | null;
}

export const PLATFORM_CONSTRAINTS: Record<string, PlatformConstraint> = {
  twitter: { maxChars: 280, maxHashtags: 3, aspectRatio: "16:9" },
  instagram: { maxChars: 2200, maxHashtags: 30, aspectRatio: "1:1" },
  facebook: { maxChars: 63206, maxHashtags: 10, aspectRatio: "1.91:1" },
  whatsapp_status: { maxChars: 700, maxHashtags: 0, aspectRatio: "9:16" },
  whatsapp: { maxChars: 4096, maxHashtags: 0, aspectRatio: null },
  sms: { maxChars: 160, maxHashtags: 0, aspectRatio: null },
};

export interface ValidationResult {
  valid: boolean;
  issues: string[];
}

export function validateContent(content: string, platform: string): ValidationResult {
  const constraints = PLATFORM_CONSTRAINTS[platform];
  if (!constraints) {
    return { valid: false, issues: [`Unknown platform: ${platform}`] };
  }

  const issues: string[] = [];

  if (content.length > constraints.maxChars) {
    issues.push(`Content exceeds ${constraints.maxChars} character limit (got ${content.length})`);
  }

  const hashtags = content.match(/#\w+/g) ?? [];
  if (hashtags.length > constraints.maxHashtags) {
    issues.push(`Too many hashtags: ${hashtags.length} (max ${constraints.maxHashtags})`);
  }

  return { valid: issues.length === 0, issues };
}

export function formatForPlatform(content: string, platform: string): string {
  const constraints = PLATFORM_CONSTRAINTS[platform];
  if (!constraints) return content;

  let result = content;

  // Trim hashtags if over limit
  if (constraints.maxHashtags === 0) {
    result = result.replace(/#\w+/g, "").trim();
  } else {
    const parts = result.split(/(#\w+)/g);
    let hashtagCount = 0;
    result = parts
      .filter((part) => {
        if (/^#\w+$/.test(part)) {
          hashtagCount++;
          return hashtagCount <= constraints.maxHashtags;
        }
        return true;
      })
      .join("")
      .trim();
  }

  // Truncate if over char limit
  if (result.length > constraints.maxChars) {
    result = result.slice(0, constraints.maxChars - 1) + "…";
  }

  return result;
}

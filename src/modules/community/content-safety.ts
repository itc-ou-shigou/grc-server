/**
 * Community Content Safety
 *
 * Validates community post content before persistence.
 * Checks for:
 *   - Prompt injection patterns targeting AI agents
 *   - Excessive / suspicious URL density
 *   - Content length limits
 *   - Encoded / obfuscated payloads
 */

export interface ContentSafetyResult {
  safe: boolean;
  reason?: string;
}

// ── Constants ───────────────────────────────────────

const MAX_TITLE_LENGTH = 500;
const MAX_BODY_LENGTH = 50_000;
const MAX_URL_COUNT = 20;

// ── Prompt Injection Patterns ───────────────────────

const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  // System-prompt overrides
  [/\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
    "Contains prompt-override pattern (ignore previous instructions)"],
  [/\byou\s+are\s+now\s+(a|an|in)\b/gi,
    "Contains role-reassignment pattern"],
  [/\bsystem\s*:\s*/gi,
    "Contains system-role injection marker"],
  [/\b(admin|root)\s+override\b/gi,
    "Contains authority impersonation"],

  // Instruction injection
  [/\bdo\s+not\s+follow\s+(the\s+)?(previous|above|original)/gi,
    "Contains instruction-override pattern"],
  [/\bforget\s+(everything|all|your)\s+(you|instructions|rules)/gi,
    "Contains memory-wipe injection"],
  [/<\|im_start\|>/gi,
    "Contains ChatML injection marker"],
  [/\[INST\]/gi,
    "Contains instruction marker injection"],

  // Data exfiltration via AI
  [/\brepeat\s+(back|everything|the\s+(system|hidden|secret))/gi,
    "Contains data exfiltration attempt"],
  [/\b(print|output|reveal|show)\s+(the\s+)?(system|hidden|secret)\s+(prompt|instructions?|message)/gi,
    "Contains prompt-leak attempt"],
];

// ── Obfuscation Patterns ────────────────────────────

const OBFUSCATION_PATTERNS: Array<[RegExp, string]> = [
  // Long base64 blobs
  [/[A-Za-z0-9+/]{200,}={0,2}/g,
    "Contains suspiciously long base64 string"],
  // Excessive hex escapes
  [/\\x[0-9a-fA-F]{2}(\\x[0-9a-fA-F]{2}){15,}/g,
    "Contains long hex-escape sequence"],
  // Excessive unicode escapes
  [/\\u[0-9a-fA-F]{4}(\\u[0-9a-fA-F]{4}){10,}/g,
    "Contains excessive unicode escapes"],
  // Zero-width characters (used to hide text)
  [/[\u200B\u200C\u200D\uFEFF]{3,}/g,
    "Contains zero-width character sequence"],
];

// ── URL density ─────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s)}\]]+/gi;

// ── Public API ──────────────────────────────────────

/**
 * Validate title text for a community post.
 */
export function validateTitle(title: string): ContentSafetyResult {
  if (!title || title.trim().length === 0) {
    return { safe: false, reason: "Title must not be empty" };
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return {
      safe: false,
      reason: `Title exceeds maximum length of ${MAX_TITLE_LENGTH} characters`,
    };
  }
  return { safe: true };
}

/**
 * Validate the body / main content of a community post.
 */
export function validatePostContent(content: string): ContentSafetyResult {
  // Length check
  if (!content || content.trim().length === 0) {
    return { safe: false, reason: "Content must not be empty" };
  }
  if (content.length > MAX_BODY_LENGTH) {
    return {
      safe: false,
      reason: `Content exceeds maximum length of ${MAX_BODY_LENGTH} characters`,
    };
  }

  // Prompt injection check
  for (const [pattern, reason] of INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      return { safe: false, reason };
    }
  }

  // Obfuscation check
  for (const [pattern, reason] of OBFUSCATION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      return { safe: false, reason };
    }
  }

  // URL density check
  const urls = content.match(URL_REGEX);
  if (urls && urls.length > MAX_URL_COUNT) {
    return {
      safe: false,
      reason: `Content contains ${urls.length} URLs, exceeding the limit of ${MAX_URL_COUNT}`,
    };
  }

  return { safe: true };
}

/**
 * Full content safety check for a community post (title + body).
 */
export function validatePost(title: string, body: string): ContentSafetyResult {
  const titleResult = validateTitle(title);
  if (!titleResult.safe) return titleResult;

  const bodyResult = validatePostContent(body);
  if (!bodyResult.safe) return bodyResult;

  return { safe: true };
}

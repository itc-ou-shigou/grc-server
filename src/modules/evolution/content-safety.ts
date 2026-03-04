/**
 * Content Safety Scanner — Pattern-based malicious code detection
 *
 * Scans Gene/Capsule payloads for dangerous patterns before approval.
 * Returns a structured result indicating whether the payload is safe.
 */

export interface SafetyScanResult {
  safe: boolean;
  reasons: string[];
}

/**
 * Dangerous code execution patterns.
 * Each entry is [regex, human-readable reason].
 */
const DANGEROUS_PATTERNS: Array<[RegExp, string]> = [
  // Direct code execution
  [/\beval\s*\(/gi, "Contains eval() call — arbitrary code execution"],
  [/\bexec\s*\(/gi, "Contains exec() call — command execution"],
  [/\bexecSync\s*\(/gi, "Contains execSync() call — synchronous command execution"],
  [/\bspawnSync?\s*\(/gi, "Contains spawn() call — process spawning"],
  [/\bexecFile\s*\(/gi, "Contains execFile() call — file execution"],

  // Node.js dangerous modules
  [/require\s*\(\s*['"]child_process['"]\s*\)/gi, "Imports child_process module"],
  [/from\s+['"]child_process['"]/gi, "Imports child_process module (ESM)"],
  [/require\s*\(\s*['"]vm['"]\s*\)/gi, "Imports vm module — sandbox escape risk"],
  [/require\s*\(\s*['"]cluster['"]\s*\)/gi, "Imports cluster module"],

  // Filesystem destruction
  [/fs\.unlinkSync\s*\(/gi, "Contains fs.unlinkSync() — file deletion"],
  [/fs\.rmdirSync\s*\(/gi, "Contains fs.rmdirSync() — directory deletion"],
  [/fs\.rmSync\s*\(/gi, "Contains fs.rmSync() — recursive deletion"],
  [/fs\.writeFileSync\s*\(/gi, "Contains fs.writeFileSync() — file overwrite"],

  // Shell injection
  [/rm\s+-rf\s+\//gi, "Contains 'rm -rf /' — destructive shell command"],
  [/rm\s+-rf\s+~/gi, "Contains 'rm -rf ~' — home directory destruction"],
  [/rm\s+-rf\s+\*/gi, "Contains 'rm -rf *' — wildcard deletion"],
  [/;\s*rm\s+-/gi, "Contains shell injection with rm command"],
  [/&&\s*rm\s+-/gi, "Contains chained rm command"],
  [/\|\s*sh\b/gi, "Contains pipe to shell execution"],
  [/\|\s*bash\b/gi, "Contains pipe to bash execution"],
  [/`[^`]*`/g, "Contains backtick command substitution"],

  // Network exfiltration
  [/curl\s+.*\|\s*sh/gi, "Contains curl | sh pattern — remote code execution"],
  [/wget\s+.*\|\s*sh/gi, "Contains wget | sh pattern — remote code execution"],

  // Windows specific
  [/powershell\s+-e(ncodedcommand)?\s+/gi, "Contains PowerShell encoded command execution"],
  [/cmd\s*\/c\s+/gi, "Contains cmd /c — Windows command execution"],
  [/del\s+\/[sfq]/gi, "Contains Windows del command with force flags"],

  // Process/environment manipulation
  [/process\.exit\s*\(/gi, "Contains process.exit() — forced termination"],
  [/process\.env\s*\[/gi, "Accesses process.env — environment variable reading"],

  // Prototype pollution
  [/__proto__/gi, "Contains __proto__ — prototype pollution risk"],
  [/constructor\s*\[\s*['"]prototype['"]\s*\]/gi, "Contains prototype access — pollution risk"],
];

/**
 * Obfuscation detection patterns.
 */
const OBFUSCATION_PATTERNS: Array<[RegExp, string]> = [
  // Excessive base64 (likely encoded payloads)
  [/[A-Za-z0-9+/]{100,}={0,2}/g, "Contains long base64-encoded string — possible obfuscated code"],
  // Hex-encoded strings
  [/\\x[0-9a-fA-F]{2}(\\x[0-9a-fA-F]{2}){20,}/g, "Contains long hex-encoded string — possible obfuscated code"],
  // Unicode escape sequences
  [/\\u[0-9a-fA-F]{4}(\\u[0-9a-fA-F]{4}){10,}/g, "Contains excessive unicode escapes — possible obfuscation"],
  // String.fromCharCode chains
  [/String\.fromCharCode\s*\([^)]{30,}\)/gi, "Contains String.fromCharCode — possible obfuscated code"],
  // atob for decoding
  [/atob\s*\(\s*['"][A-Za-z0-9+/]{50,}/gi, "Contains atob() with long encoded string"],
];

/**
 * Recursively extract all string values from a nested object.
 */
function extractStrings(obj: unknown): string[] {
  const strings: string[] = [];

  if (typeof obj === "string") {
    strings.push(obj);
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      strings.push(...extractStrings(item));
    }
  } else if (obj !== null && typeof obj === "object") {
    for (const value of Object.values(obj as Record<string, unknown>)) {
      strings.push(...extractStrings(value));
    }
  }

  return strings;
}

/**
 * Scan a Gene/Capsule payload for malicious content.
 *
 * Extracts all string values from the payload object and tests them
 * against known dangerous and obfuscation patterns.
 */
export function scanPayload(payload: Record<string, unknown>): SafetyScanResult {
  const reasons: string[] = [];
  const allStrings = extractStrings(payload);
  const combinedText = allStrings.join("\n");

  // Check dangerous patterns
  for (const [pattern, reason] of DANGEROUS_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    if (pattern.test(combinedText)) {
      reasons.push(reason);
    }
  }

  // Check obfuscation patterns
  for (const [pattern, reason] of OBFUSCATION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(combinedText)) {
      reasons.push(reason);
    }
  }

  return {
    safe: reasons.length === 0,
    reasons,
  };
}

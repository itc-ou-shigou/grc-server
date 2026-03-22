/**
 * ClawHub+ Module -- Local Filesystem Storage Layer
 *
 * Handles tarball upload, download, SHA-256 checksum computation,
 * and deletion for skill packages stored on the local filesystem.
 *
 * Used in Desktop (Electron + SQLite) mode when Azure Blob Storage
 * credentials are not available.
 *
 * Default storage path:
 *   %APPDATA%/GRC/data/skills/{slug}/{version}.tar.gz
 *
 * Can be overridden via:
 *   - GRC_SKILLS_LOCAL_PATH env var
 *   - basePath argument to initLocalStorage()
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pino from "pino";

const logger = pino({ name: "module:clawhub:storage-local" });

// Fix: GRC_SKILLS_LOCAL_PATH already points to the final directory,
// so use it directly. Only append "data/skills" for fallback paths.
const DEFAULT_SKILLS_DIR =
  process.env.GRC_SKILLS_LOCAL_PATH ||
  path.join(
    process.env.GRC_DATA_DIR || path.join(process.env.APPDATA || "", "GRC"),
    "data",
    "skills",
  );

/**
 * Defense-in-depth: prevent path traversal via slug or version parameters.
 * Route-layer validation (Zod schemas) is the primary guard, but storage
 * should never trust its callers blindly.
 */
function assertSafeName(value: string, label: string): void {
  if (value.includes("..") || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error(`Invalid ${label}: must not contain path separators or traversal sequences`);
  }
}

let skillsDir: string = DEFAULT_SKILLS_DIR;

/**
 * Initialize local storage by ensuring the base directory exists.
 *
 * @param basePath - Optional override for the skills storage directory.
 *                   Falls back to GRC_SKILLS_LOCAL_PATH, GRC_DATA_DIR,
 *                   or %APPDATA%/GRC/data/skills.
 */
export function initLocalStorage(basePath?: string): void {
  skillsDir = basePath || DEFAULT_SKILLS_DIR;
  fs.mkdirSync(skillsDir, { recursive: true });
  logger.info({ skillsDir }, "Local skill storage initialized");
}

/**
 * Compute the SHA-256 hash of a buffer.
 * Returns a lowercase hex string (64 characters).
 */
export function computeSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Upload a skill tarball to local filesystem storage.
 *
 * @param slug - The skill slug
 * @param version - The semver version string
 * @param buffer - The tarball file buffer
 * @returns A local:// URI identifying the stored tarball
 */
export async function uploadTarball(
  slug: string,
  version: string,
  buffer: Buffer,
): Promise<string> {
  assertSafeName(slug, "slug");
  assertSafeName(version, "version");
  const dir = path.join(skillsDir, slug);
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${version}.tar.gz`);
  fs.writeFileSync(filePath, buffer);

  const uri = `local://${slug}/${version}.tar.gz`;
  logger.info(
    { slug, version, filePath, size: buffer.length },
    "Tarball saved to local storage",
  );
  return uri;
}

/**
 * Get the absolute filesystem path of a stored tarball.
 *
 * @param slug - The skill slug
 * @param version - The semver version string
 * @returns Absolute path to the tarball file
 */
export function getTarballPath(slug: string, version: string): string {
  assertSafeName(slug, "slug");
  assertSafeName(version, "version");
  return path.join(skillsDir, slug, `${version}.tar.gz`);
}

/**
 * Get a download URL for a skill tarball.
 * In local mode this returns an Express API route path
 * (not a presigned blob URL).
 *
 * @param slug - The skill slug
 * @param version - The semver version string
 * @returns API download URL path
 */
export async function getTarballUrl(
  slug: string,
  version: string,
): Promise<string> {
  assertSafeName(slug, "slug");
  assertSafeName(version, "version");
  return `/api/v1/skills/${slug}/download/${version}`;
}

/**
 * Delete a skill tarball from local filesystem storage.
 * Silently succeeds if the file does not exist.
 * Cleans up the parent directory if it becomes empty.
 *
 * @param slug - The skill slug
 * @param version - The semver version string
 */
export async function deleteTarball(
  slug: string,
  version: string,
): Promise<void> {
  assertSafeName(slug, "slug");
  assertSafeName(version, "version");
  const filePath = path.join(skillsDir, slug, `${version}.tar.gz`);
  try {
    fs.unlinkSync(filePath);
    logger.info({ slug, version, filePath }, "Tarball deleted from local storage");

    // Clean up empty slug directory
    const dir = path.join(skillsDir, slug);
    const remaining = fs.readdirSync(dir);
    if (remaining.length === 0) {
      fs.rmdirSync(dir);
      logger.debug({ dir }, "Removed empty skill directory");
    }
  } catch (err: unknown) {
    // ENOENT = file does not exist -- not an error
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.debug({ slug, version }, "Tarball already absent, nothing to delete");
      return;
    }
    // Re-throw unexpected errors (permission issues, etc.)
    throw err;
  }
}

/**
 * ClawHub+ Module -- MinIO/S3 Storage Layer
 *
 * Handles tarball upload, download, presigned URL generation,
 * SHA-256 checksum computation, and deletion for skill packages.
 */

import { Client as MinioClient } from "minio";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import pino from "pino";
import type { GrcConfig } from "../../config.js";

const logger = pino({ name: "module:clawhub:storage" });

let client: MinioClient | null = null;
let bucketName = "grc-assets";

/**
 * Build the object key path for a skill tarball.
 * Format: skills/{slug}/{version}.tar.gz
 */
function objectKey(slug: string, version: string): string {
  return `skills/${slug}/${version}.tar.gz`;
}

/**
 * Initialize the MinIO client and ensure the target bucket exists.
 */
export async function initStorage(config: GrcConfig["minio"]): Promise<void> {
  client = new MinioClient({
    endPoint: config.endpoint,
    port: config.port,
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
  });

  bucketName = config.bucket;

  const exists = await client.bucketExists(bucketName);
  if (!exists) {
    await client.makeBucket(bucketName);
    logger.info({ bucket: bucketName }, "Created MinIO bucket");
  } else {
    logger.info({ bucket: bucketName }, "MinIO bucket verified");
  }
}

/**
 * Get the initialized MinIO client. Throws if not initialized.
 */
function getClient(): MinioClient {
  if (!client) {
    throw new Error("MinIO storage not initialized. Call initStorage() first.");
  }
  return client;
}

/**
 * Compute the SHA-256 hash of a buffer.
 * Returns a lowercase hex string (64 characters).
 */
export function computeSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Upload a skill tarball to MinIO.
 *
 * @param slug - The skill slug
 * @param version - The semver version string
 * @param buffer - The tarball file buffer
 * @returns The object storage URL
 */
export async function uploadTarball(
  slug: string,
  version: string,
  buffer: Buffer,
): Promise<string> {
  const mc = getClient();
  const key = objectKey(slug, version);

  const stream = Readable.from(buffer);
  await mc.putObject(bucketName, key, stream, buffer.length, {
    "Content-Type": "application/gzip",
  });

  const url = `${bucketName}/${key}`;
  logger.info({ slug, version, key, size: buffer.length }, "Tarball uploaded");
  return url;
}

/**
 * Generate a presigned download URL for a skill tarball.
 * The URL is valid for 1 hour (3600 seconds).
 *
 * @param slug - The skill slug
 * @param version - The semver version string
 * @returns Presigned URL string
 */
export async function getTarballUrl(
  slug: string,
  version: string,
): Promise<string> {
  const mc = getClient();
  const key = objectKey(slug, version);
  const expiry = 3600; // 1 hour

  const url = await mc.presignedGetObject(bucketName, key, expiry);
  return url;
}

/**
 * Delete a skill tarball from MinIO.
 *
 * @param slug - The skill slug
 * @param version - The semver version string
 */
export async function deleteTarball(
  slug: string,
  version: string,
): Promise<void> {
  const mc = getClient();
  const key = objectKey(slug, version);

  await mc.removeObject(bucketName, key);
  logger.info({ slug, version, key }, "Tarball deleted");
}

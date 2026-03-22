/**
 * ClawHub+ Module -- Storage Factory
 *
 * Provides a unified SkillStorage interface with two backends:
 *   - Azure Blob Storage (when accountName + accountKey are configured)
 *   - Local filesystem (Desktop / Electron mode)
 *
 * Backward-compatible: the top-level exported functions
 * (uploadTarball, getTarballUrl, deleteTarball, computeSha256)
 * delegate to whichever backend was selected by initStorage().
 */

import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  type ContainerClient,
} from "@azure/storage-blob";
import { createHash } from "node:crypto";
import pino from "pino";
import type { GrcConfig } from "../../config.js";
import * as localStorage from "./storage-local.js";

const logger = pino({ name: "module:clawhub:storage" });

// ── Interface ─────────────────────────────────────────────────

/**
 * Unified storage interface for skill tarballs.
 * Implemented by both Azure and local backends.
 */
export interface SkillStorage {
  uploadTarball(slug: string, version: string, buffer: Buffer): Promise<string>;
  getTarballUrl(slug: string, version: string): Promise<string>;
  deleteTarball(slug: string, version: string): Promise<void>;
  computeSha256(buffer: Buffer): string;
  /** true when using local filesystem storage (Desktop mode) */
  isLocal: boolean;
}

// ── Azure Backend (kept inline to minimise diff) ──────────────

let containerClient: ContainerClient | null = null;
let credential: StorageSharedKeyCredential | null = null;
let containerName = "skills";

function objectKey(slug: string, version: string): string {
  return `skills/${slug}/${version}.tar.gz`;
}

function getContainerClient(): ContainerClient {
  if (!containerClient) {
    throw new Error(
      "Azure Blob storage not initialized. Call initStorage() first.",
    );
  }
  return containerClient;
}

function getCredential(): StorageSharedKeyCredential {
  if (!credential) {
    throw new Error(
      "Azure Blob storage not initialized. Call initStorage() first.",
    );
  }
  return credential;
}

async function azureInit(config: GrcConfig["azure"]): Promise<void> {
  credential = new StorageSharedKeyCredential(
    config.accountName,
    config.accountKey,
  );

  const blobServiceClient = new BlobServiceClient(
    `https://${config.accountName}.blob.core.windows.net`,
    credential,
  );

  containerName = config.containerName;
  containerClient = blobServiceClient.getContainerClient(containerName);

  const createResponse = await containerClient.createIfNotExists();
  if (createResponse.succeeded) {
    logger.info({ container: containerName }, "Created Azure Blob container");
  } else {
    logger.info({ container: containerName }, "Azure Blob container verified");
  }
}

function azureComputeSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function azureUploadTarball(
  slug: string,
  version: string,
  buffer: Buffer,
): Promise<string> {
  const cc = getContainerClient();
  const key = objectKey(slug, version);

  const blockBlobClient = cc.getBlockBlobClient(key);
  await blockBlobClient.upload(buffer, buffer.length, {
    blobHTTPHeaders: {
      blobContentType: "application/gzip",
    },
  });

  const url = `${containerName}/${key}`;
  logger.info({ slug, version, key, size: buffer.length }, "Tarball uploaded to Azure Blob");
  return url;
}

async function azureGetTarballUrl(
  slug: string,
  version: string,
): Promise<string> {
  const cc = getContainerClient();
  const cred = getCredential();
  const key = objectKey(slug, version);

  const blobClient = cc.getBlobClient(key);

  const expiresOn = new Date();
  expiresOn.setHours(expiresOn.getHours() + 1);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: key,
      permissions: BlobSASPermissions.parse("r"),
      expiresOn,
    },
    cred,
  ).toString();

  return `${blobClient.url}?${sasToken}`;
}

async function azureDeleteTarball(
  slug: string,
  version: string,
): Promise<void> {
  const cc = getContainerClient();
  const key = objectKey(slug, version);

  const blobClient = cc.getBlobClient(key);
  await blobClient.deleteIfExists();
  logger.info({ slug, version, key }, "Tarball deleted from Azure Blob");
}

// ── Factory ───────────────────────────────────────────────────

let _storage: SkillStorage | null = null;

/**
 * Initialize the skill storage backend.
 *
 * When valid Azure credentials (accountName AND accountKey) are provided,
 * the Azure Blob Storage backend is used. Otherwise, local filesystem
 * storage is selected automatically (Desktop mode).
 *
 * @param azureConfig - Azure storage configuration (may have empty strings)
 */
export async function initStorage(
  azureConfig?: GrcConfig["azure"],
): Promise<void> {
  if (azureConfig?.accountName && azureConfig?.accountKey) {
    // ---- Azure backend ----
    await azureInit(azureConfig);
    _storage = {
      uploadTarball: azureUploadTarball,
      getTarballUrl: azureGetTarballUrl,
      deleteTarball: azureDeleteTarball,
      computeSha256: azureComputeSha256,
      isLocal: false,
    };
    logger.info("Skill storage backend: Azure Blob Storage");
  } else {
    // ---- Local filesystem backend ----
    localStorage.initLocalStorage();
    _storage = {
      uploadTarball: localStorage.uploadTarball,
      getTarballUrl: localStorage.getTarballUrl,
      deleteTarball: localStorage.deleteTarball,
      computeSha256: localStorage.computeSha256,
      isLocal: true,
    };
    logger.info("Skill storage backend: local filesystem");
  }
}

/**
 * Get the active storage instance.
 * Throws if initStorage() has not been called.
 */
export function getStorage(): SkillStorage {
  if (!_storage) {
    throw new Error(
      "Skill storage not initialized. Call initStorage() first.",
    );
  }
  return _storage;
}

// ── Backward-compatible named exports ─────────────────────────
//
// service.ts imports these directly:
//   import { uploadTarball, deleteTarball, computeSha256, getTarballUrl } from "./storage.js";
//
// These thin wrappers delegate to whichever backend was selected.

export function computeSha256(buffer: Buffer): string {
  if (!_storage) {
    // Fallback: computeSha256 is a pure function, safe to call before init
    return createHash("sha256").update(buffer).digest("hex");
  }
  return _storage.computeSha256(buffer);
}

export async function uploadTarball(
  slug: string,
  version: string,
  buffer: Buffer,
): Promise<string> {
  return getStorage().uploadTarball(slug, version, buffer);
}

export async function getTarballUrl(
  slug: string,
  version: string,
): Promise<string> {
  return getStorage().getTarballUrl(slug, version);
}

export async function deleteTarball(
  slug: string,
  version: string,
): Promise<void> {
  return getStorage().deleteTarball(slug, version);
}

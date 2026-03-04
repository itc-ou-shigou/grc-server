/**
 * GRC Server Configuration
 *
 * All configuration is driven by environment variables.
 * Module toggles allow disabling individual modules at runtime.
 */

import { generateKeyPairSync } from "node:crypto";
import pino from "pino";

const configLogger = pino({ name: "config" });

export interface GrcConfig {
  port: number;
  nodeEnv: string;
  logLevel: string;

  database: {
    url: string;
  };

  redis: {
    url: string;
  };

  minio: {
    endpoint: string;
    port: number;
    accessKey: string;
    secretKey: string;
    bucket: string;
    useSSL: boolean;
  };

  meilisearch: {
    url: string;
    apiKey: string;
  };

  jwt: {
    privateKey: string;
    publicKey: string;
    issuer: string;
    expiresIn: string;
    refreshTokenExpiresIn: string;
  };

  oauth: {
    github: {
      clientId: string;
      clientSecret: string;
      callbackUrl: string;
    };
    google: {
      clientId: string;
      clientSecret: string;
      callbackUrl: string;
    };
  };

  modules: {
    auth: boolean;
    clawhub: boolean;
    evolution: boolean;
    update: boolean;
    telemetry: boolean;
    community: boolean;
    platform: boolean;
  };

  smtp: {
    host: string;
    port: number;
    user: string;
    password: string;
    fromEmail: string;
    fromName: string;
  };

  admin: {
    emails: string[];
  };
}

/**
 * Generate an RSA key pair for development use.
 * These keys are ephemeral and regenerated on every restart.
 */
function generateDevKeyPair(): { publicKey: string; privateKey: string } {
  configLogger.warn(
    "JWT_PRIVATE_KEY and JWT_PUBLIC_KEY not set — generating ephemeral RSA key pair. " +
    "This is acceptable for development but MUST NOT be used in production.",
  );
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function envBool(key: string, defaultValue: boolean): boolean {
  const val = process.env[key]?.trim().toLowerCase();
  if (val === undefined || val === "") return defaultValue;
  return val !== "false" && val !== "0";
}

function envString(key: string, defaultValue: string): string {
  return process.env[key]?.trim() || defaultValue;
}

function envInt(key: string, defaultValue: number): number {
  const val = process.env[key]?.trim();
  if (!val) return defaultValue;
  const parsed = Number.parseInt(val, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function loadConfig(): GrcConfig {
  const nodeEnv = envString("NODE_ENV", "development");

  // RS256 key pair for JWT signing/verification
  let jwtPrivateKey = process.env.JWT_PRIVATE_KEY?.trim() || "";
  let jwtPublicKey = process.env.JWT_PUBLIC_KEY?.trim() || "";

  // Fail fast: reject missing keys in production
  if (nodeEnv === "production" && (!jwtPrivateKey || !jwtPublicKey)) {
    throw new Error(
      "FATAL: JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be set in production. " +
      "Generate an RSA key pair and provide them as PEM-encoded environment variables.",
    );
  }

  // In development, auto-generate an ephemeral RSA key pair if not provided
  if (!jwtPrivateKey || !jwtPublicKey) {
    const devKeys = generateDevKeyPair();
    jwtPrivateKey = devKeys.privateKey;
    jwtPublicKey = devKeys.publicKey;
  }

  return {
    port: envInt("PORT", 3100),
    nodeEnv,
    logLevel: envString("LOG_LEVEL", "info"),

    database: {
      url: envString(
        "DATABASE_URL",
        "mysql://root:Admin123@localhost:3306/grc-server",
      ),
    },

    redis: {
      url: envString("REDIS_URL", "redis://localhost:6379"),
    },

    minio: {
      endpoint: envString("MINIO_ENDPOINT", "localhost"),
      port: envInt("MINIO_PORT", 9000),
      accessKey: envString("MINIO_ACCESS_KEY", "minioadmin"),
      secretKey: envString("MINIO_SECRET_KEY", "minioadmin"),
      bucket: envString("MINIO_BUCKET", "grc-assets"),
      useSSL: envBool("MINIO_USE_SSL", false),
    },

    meilisearch: {
      url: envString("MEILISEARCH_URL", "http://localhost:7700"),
      apiKey: envString("MEILISEARCH_KEY", "grc-meili-key"),
    },

    jwt: {
      privateKey: jwtPrivateKey,
      publicKey: jwtPublicKey,
      issuer: envString("JWT_ISSUER", "grc.winclawhub.ai"),
      expiresIn: envString("JWT_EXPIRES_IN", "24h"),
      refreshTokenExpiresIn: envString("JWT_REFRESH_EXPIRES_IN", "30d"),
    },

    oauth: {
      github: {
        clientId: envString("GITHUB_CLIENT_ID", ""),
        clientSecret: envString("GITHUB_CLIENT_SECRET", ""),
        callbackUrl: envString(
          "GITHUB_CALLBACK_URL",
          "http://localhost:3100/auth/github/callback",
        ),
      },
      google: {
        clientId: envString("GOOGLE_CLIENT_ID", ""),
        clientSecret: envString("GOOGLE_CLIENT_SECRET", ""),
        callbackUrl: envString(
          "GOOGLE_CALLBACK_URL",
          "http://localhost:3100/auth/google/callback",
        ),
      },
    },

    smtp: {
      host: envString("SMTP_HOST", ""),
      port: envInt("SMTP_PORT", 587),
      user: envString("SMTP_USER", ""),
      password: envString("SMTP_PASSWORD", ""),
      fromEmail: envString("SMTP_FROM_EMAIL", ""),
      fromName: envString("SMTP_FROM_NAME", "GRC"),
    },

    modules: {
      auth: envBool("GRC_MODULE_AUTH", true),
      clawhub: envBool("GRC_MODULE_CLAWHUB", true),
      evolution: envBool("GRC_MODULE_EVOLUTION", true),
      update: envBool("GRC_MODULE_UPDATE", true),
      telemetry: envBool("GRC_MODULE_TELEMETRY", true),
      community: envBool("GRC_MODULE_COMMUNITY", false),
      platform: envBool("GRC_MODULE_PLATFORM", true),
    },

    admin: {
      emails: envString("ADMIN_EMAILS", "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean),
    },
  };
}

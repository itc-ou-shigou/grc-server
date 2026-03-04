/**
 * Auth Module — Drizzle ORM Schema
 *
 * Maps to the `users`, `api_keys`, `refresh_tokens`, and `verification_codes` tables.
 */

import crypto from "node:crypto";
import {
  mysqlTable,
  char,
  varchar,
  timestamp,
  int,
  json,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ── Users Table ─────────────────────────────────

export const users = mysqlTable(
  "users",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    provider: varchar("provider", { length: 20 }).notNull(),
    providerId: varchar("provider_id", { length: 255 }).notNull(),
    displayName: varchar("display_name", { length: 255 }),
    avatarUrl: varchar("avatar_url", { length: 500 }),
    email: varchar("email", { length: 255 }),
    passwordHash: varchar("password_hash", { length: 255 }),
    tier: varchar("tier", { length: 20 }).notNull().default("free"),
    role: varchar("role", { length: 20 }).notNull().default("user"),
    promotedAssetCount: int("promoted_asset_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex("uk_provider").on(table.provider, table.providerId),
    index("idx_tier").on(table.tier),
    index("idx_email").on(table.email),
  ],
);

// ── API Keys Table ──────────────────────────────

export const apiKeys = mysqlTable(
  "api_keys",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    userId: char("user_id", { length: 36 }).notNull(),
    keyHash: varchar("key_hash", { length: 255 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    scopes: json("scopes").notNull().$type<string[]>(),
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uk_key_hash").on(table.keyHash),
    index("idx_key_prefix").on(table.keyPrefix),
    index("idx_user_id").on(table.userId),
  ],
);

// ── Refresh Tokens Table ────────────────────────

export const refreshTokens = mysqlTable(
  "refresh_tokens",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    userId: char("user_id", { length: 36 }).notNull(),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uk_token_hash").on(table.tokenHash),
    index("idx_rt_user_id").on(table.userId),
    index("idx_rt_expires_at").on(table.expiresAt),
  ],
);

// ── Verification Codes Table ──────────────────

export const verificationCodes = mysqlTable(
  "verification_codes",
  {
    id: char("id", { length: 36 })
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    email: varchar("email", { length: 255 }).notNull(),
    code: varchar("code", { length: 6 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    attempts: int("attempts").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_vc_email_code").on(table.email, table.code),
    index("idx_vc_expires").on(table.expiresAt),
  ],
);

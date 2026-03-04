/**
 * ClawHub+ Module -- Drizzle ORM Schema (MySQL)
 *
 * Maps to the ClawHub+ tables defined in 001_initial.sql:
 *   skills, skill_versions, skill_ratings, skill_downloads
 */

import {
  mysqlTable,
  char,
  varchar,
  int,
  float,
  tinyint,
  json,
  timestamp,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";

// -- Skills Table --------------------------------------------

export const skillsTable = mysqlTable(
  "skills",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    authorId: char("author_id", { length: 36 }),
    category: varchar("category", { length: 100 }),
    tags: json("tags").$type<string[]>(),
    latestVersion: varchar("latest_version", { length: 50 }),
    downloadCount: int("download_count").notNull().default(0),
    ratingAvg: float("rating_avg").notNull().default(0),
    ratingCount: int("rating_count").notNull().default(0),
    isOfficial: tinyint("is_official").notNull().default(0),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex("uk_slug").on(table.slug),
    index("idx_author").on(table.authorId),
    index("idx_download_count").on(table.downloadCount),
    index("idx_status").on(table.status),
  ],
);

// -- Skill Versions Table ------------------------------------

export const skillVersionsTable = mysqlTable(
  "skill_versions",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    skillId: char("skill_id", { length: 36 }).notNull(),
    version: varchar("version", { length: 50 }).notNull(),
    changelog: text("changelog"),
    tarballUrl: varchar("tarball_url", { length: 500 }).notNull(),
    checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
    tarballSize: int("tarball_size").notNull().default(0),
    minWinclawVersion: varchar("min_winclaw_version", { length: 50 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uk_skill_version").on(table.skillId, table.version),
  ],
);

// -- Skill Ratings Table -------------------------------------

export const skillRatingsTable = mysqlTable(
  "skill_ratings",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    skillId: char("skill_id", { length: 36 }).notNull(),
    userId: char("user_id", { length: 36 }).notNull(),
    rating: tinyint("rating").notNull(),
    review: text("review"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex("uk_skill_user_rating").on(table.skillId, table.userId),
  ],
);

// -- Skill Downloads Table -----------------------------------

export const skillDownloadsTable = mysqlTable(
  "skill_downloads",
  {
    id: char("id", { length: 36 }).primaryKey().notNull(),
    skillId: char("skill_id", { length: 36 }).notNull(),
    version: varchar("version", { length: 50 }),
    nodeId: varchar("node_id", { length: 255 }),
    userId: char("user_id", { length: 36 }),
    ipHash: varchar("ip_hash", { length: 64 }),
    downloadedAt: timestamp("downloaded_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_skill_id").on(table.skillId),
    index("idx_downloaded_at").on(table.downloadedAt),
  ],
);

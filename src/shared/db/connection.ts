/**
 * Database Connection — Shared Database Layer
 *
 * Supports both MySQL (server) and SQLite (desktop) via dialect detection.
 * All modules share a single database instance through getDb().
 *
 * Backward-compatible: existing callers of getDb() / getPool() / initDatabase()
 * continue to work unchanged when running in MySQL mode.
 */

import crypto from "node:crypto";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import mysql from "mysql2/promise";
import pino from "pino";
import type { DbDialect } from "./adapter.js";
import { detectDialect, getDbConfig } from "./dialect.js";
import { getDefaultSqlitePath } from "./adapter.js";
import { runSqliteMigrations } from "./migrate-sqlite.js";

const logger = pino({ name: "db" });

let currentDialect: DbDialect | null = null;
let pool: mysql.Pool | null = null;
let sqliteRaw: ReturnType<typeof Database> | null = null;

// Type the db instance as MySQL Drizzle for API compatibility with existing code.
// At runtime, this may hold a SQLite Drizzle instance which exposes the same
// query-builder surface (select/insert/update/delete). The MySQL type is used
// purely to keep TypeScript happy across the ~30 existing service files.
type DrizzleMySqlDb = ReturnType<typeof drizzleMysql>;
let db: DrizzleMySqlDb | null = null;

/**
 * Initialize the database connection.
 *
 * - When called with a MySQL URL string (legacy), behaves exactly as before.
 * - When called with no arguments, auto-detects dialect from environment.
 */
export async function initDatabase(databaseUrl?: string): Promise<DrizzleMySqlDb> {
  if (db) return db;

  // Legacy call: explicit MySQL URL passed in
  if (databaseUrl) {
    return initMysql(databaseUrl);
  }

  // Auto-detect from environment
  const config = getDbConfig();

  if (config.dialect === "mysql") {
    if (!config.mysqlUrl) {
      throw new Error(
        "MySQL dialect selected but DATABASE_URL is not set.",
      );
    }
    return initMysql(config.mysqlUrl);
  }

  return initSqlite(config.sqlitePath);
}

async function initMysql(url: string) {
  pool = mysql.createPool({
    uri: url,
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 100,
    enableKeepAlive: true,
    keepAliveInitialDelay: 30_000,
  });

  // Verify connectivity
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();

  currentDialect = "mysql";
  db = drizzleMysql(pool);
  logger.info("MySQL connection pool initialized");
  return db;
}

function initSqlite(dbPath?: string) {
  const finalPath = dbPath ?? getDefaultSqlitePath();

  sqliteRaw = new Database(finalPath);
  sqliteRaw.pragma("journal_mode = WAL");
  sqliteRaw.pragma("foreign_keys = ON");
  sqliteRaw.pragma("busy_timeout = 30000");
  sqliteRaw.pragma("synchronous = NORMAL");
  sqliteRaw.pragma("cache_size = -64000"); // 64MB cache
  sqliteRaw.pragma("temp_store = MEMORY");

  // Register MySQL-compatible functions for Drizzle schema defaults
  sqliteRaw.function("NOW", () => new Date().toISOString());
  sqliteRaw.function("UUID", () => crypto.randomUUID());
  // DATEDIFF(a, b) — returns days between two dates (MySQL compat)
  sqliteRaw.function("DATEDIFF", (a: string, b: string) => {
    if (!a || !b) return null;
    return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
  });

  // Run migrations to create/update tables
  runSqliteMigrations(sqliteRaw);

  currentDialect = "sqlite";
  // Cast to MySQL Drizzle type for API surface compatibility.
  const rawDrizzle = drizzleSqlite(sqliteRaw);

  // Patch: Drizzle passes Date objects as query params which SQLite rejects.
  // Wrap the execute method to serialize Dates to ISO strings before binding.
  const origExec = sqliteRaw.prepare.bind(sqliteRaw);
  sqliteRaw.prepare = function patchedPrepare(source: string) {
    const stmt = origExec(source);
    const origAll = stmt.all.bind(stmt);
    const origRun = stmt.run.bind(stmt);
    const origGet = stmt.get.bind(stmt);
    const fixParams = (params: any[]) =>
      params.map((p: any) => (p instanceof Date ? p.toISOString() : p));
    // Patch output: convert ISO date strings back to Date objects so Drizzle's
    // MySQL timestamp mapper (which expects Date) works correctly with SQLite TEXT columns.
    const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;
    const fixRow = (row: any) => {
      if (!row || typeof row !== "object") return row;
      for (const key of Object.keys(row)) {
        const v = row[key];
        if (typeof v === "string" && ISO_DATE_RE.test(v)) {
          row[key] = new Date(v);
        }
      }
      return row;
    };
    const fixRows = (rows: any[]) => rows?.map(fixRow) ?? rows;
    stmt.all = (...args: any[]) => fixRows(origAll(...fixParams(args)));
    stmt.run = (...args: any[]) => origRun(...fixParams(args));
    stmt.get = (...args: any[]) => fixRow(origGet(...fixParams(args)));
    return stmt;
  } as typeof sqliteRaw.prepare;

  db = rawDrizzle as unknown as DrizzleMySqlDb;
  logger.info({ path: finalPath }, "SQLite database initialized");
  return db;
}

/**
 * Returns the active Drizzle database instance.
 * Works for both MySQL and SQLite dialects.
 */
export function getDb() {
  if (!db) {
    throw new Error(
      "Database not initialized. Call initDatabase() first.",
    );
  }
  return db;
}

/**
 * Returns the current dialect ("mysql" | "sqlite").
 */
export function getDialect(): DbDialect {
  if (!currentDialect) {
    throw new Error(
      "Database not initialized. Call initDatabase() first.",
    );
  }
  return currentDialect;
}

/**
 * Execute a function transactionally.
 * MySQL: uses real db.transaction() with async support.
 * SQLite (better-sqlite3): cannot use async inside transactions,
 * so we run the function directly (auto-commit per statement).
 * This is safe for Desktop mode (single user, no concurrency).
 */
export async function safeTransaction<T>(
  db: ReturnType<typeof getDb>,
  fn: (tx: ReturnType<typeof getDb>) => Promise<T>,
): Promise<T> {
  if (currentDialect === "sqlite") {
    // SQLite: run without transaction wrapper (better-sqlite3 doesn't support async tx)
    return fn(db);
  }
  // MySQL: real async transaction
  return (db as any).transaction(fn);
}

/**
 * Returns the MySQL connection pool.
 * Throws if running in SQLite mode.
 */
export function getPool() {
  if (!pool) {
    if (currentDialect === "sqlite") {
      throw new Error(
        "getPool() is not available in SQLite mode. Use getDb() instead.",
      );
    }
    throw new Error(
      "Database not initialized. Call initDatabase() first.",
    );
  }
  return pool;
}

/**
 * Close the active database connection (MySQL pool or SQLite handle).
 */
export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("MySQL connection pool closed");
  }
  if (sqliteRaw) {
    sqliteRaw.close();
    sqliteRaw = null;
    logger.info("SQLite database closed");
  }
  db = null;
  currentDialect = null;
}

/**
 * MySQL Connection Pool — Shared Database Layer
 *
 * All modules share a single MySQL database and connection pool.
 * Each module defines its own Drizzle schema, but all tables reside
 * in the same database (`grc-server`).
 */

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import pino from "pino";

const logger = pino({ name: "db" });

let pool: mysql.Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export async function initDatabase(databaseUrl: string) {
  if (pool) return db!;

  // Parse the URL — mysql2 accepts connection URIs directly
  pool = mysql.createPool({
    uri: databaseUrl,
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 30_000,
  });

  // Verify connectivity
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
  logger.info("MySQL connection pool initialized");

  db = drizzle(pool);
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error(
      "Database not initialized. Call initDatabase() first.",
    );
  }
  return db;
}

export function getPool() {
  if (!pool) {
    throw new Error(
      "Database not initialized. Call initDatabase() first.",
    );
  }
  return pool;
}

export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
    logger.info("MySQL connection pool closed");
  }
}

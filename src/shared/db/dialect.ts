/**
 * Dialect Detection — Determines MySQL vs SQLite from environment
 *
 * Priority order:
 *   1. Explicit GRC_DB_DIALECT env var ("mysql" | "sqlite")
 *   2. DATABASE_URL presence (implies MySQL)
 *   3. Default to SQLite (desktop mode)
 */

export type DbDialect = "mysql" | "sqlite";

export function detectDialect(): DbDialect {
  const explicit = process.env.GRC_DB_DIALECT;
  if (explicit === "mysql" || explicit === "sqlite") return explicit;

  if (process.env.DATABASE_URL?.startsWith("mysql://")) return "mysql";

  return "sqlite"; // Default for desktop
}

// At the module level, cache the dialect
let _currentDialect: DbDialect | null = null;

export function getCurrentDialect(): DbDialect {
  if (_currentDialect) return _currentDialect;
  _currentDialect = detectDialect();
  return _currentDialect;
}

export function getDbConfig() {
  const dialect = detectDialect();
  return {
    dialect,
    mysqlUrl: dialect === "mysql" ? process.env.DATABASE_URL : undefined,
    sqlitePath: dialect === "sqlite"
      ? process.env.GRC_SQLITE_PATH
      : undefined,
  };
}

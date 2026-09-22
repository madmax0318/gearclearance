import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

export const DEFAULT_DB_PATH = fileURLToPath(new URL("../data/price_history.sqlite", import.meta.url));

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY,
  merchant TEXT NOT NULL,
  title_norm TEXT NOT NULL,
  sku TEXT,
  title_raw TEXT,
  price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT,
  seen_at TEXT NOT NULL,
  aisle TEXT,
  category TEXT
);
CREATE INDEX IF NOT EXISTS idx_price_history_key
  ON price_history (merchant, title_norm, sku, seen_at);
`;

export function resolveDbPath(env = process.env, fallback = DEFAULT_DB_PATH) {
  const configured = env?.PRICE_HISTORY_DB;
  if (configured == null || String(configured).trim() === "") return fallback;
  const value = String(configured).trim();
  if (value === ":memory:") return value;
  return path.resolve(value);
}

export function migratePriceDb(db) {
  db.exec(SCHEMA_SQL);
  return db;
}

export function openPriceDb(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 3000");
  if (dbPath !== ":memory:") db.pragma("journal_mode = WAL");
  migratePriceDb(db);
  return db;
}

export function insertSnapshot(db, row) {
  const info = db
    .prepare(
      `INSERT INTO price_history (
        merchant, title_norm, sku, title_raw, price, currency, source, seen_at, aisle, category
      ) VALUES (
        @merchant, @title_norm, @sku, @title_raw, @price, @currency, @source, @seen_at, @aisle, @category
      )`,
    )
    .run(row);
  return Number(info.lastInsertRowid);
}

export function selectHistory(db, { merchant, title_norm, sku }) {
  if (sku) {
    return db
      .prepare(
        `SELECT price, currency, seen_at, sku, title_norm, source
         FROM price_history
         WHERE merchant = ? AND (sku = ? OR title_norm = ?)
         ORDER BY seen_at ASC, id ASC`,
      )
      .all(merchant, sku, title_norm);
  }
  return db
    .prepare(
      `SELECT price, currency, seen_at, sku, title_norm, source
       FROM price_history
       WHERE merchant = ? AND title_norm = ?
       ORDER BY seen_at ASC, id ASC`,
    )
    .all(merchant, title_norm);
}

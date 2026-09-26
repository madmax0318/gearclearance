import Database from "better-sqlite3";

export function openState(file = ":memory:") {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_prs (
      id INTEGER PRIMARY KEY,
      day TEXT NOT NULL,
      job TEXT NOT NULL,
      branch TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS picks (
      file_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

export function countPulls(db, day) {
  return db.prepare("SELECT COUNT(*) AS n FROM bot_prs WHERE day = ?").get(day).n;
}

export function recordPull(db, { day, job, branch }) {
  db.prepare("INSERT INTO bot_prs (day, job, branch) VALUES (?, ?, ?)").run(day, job, branch);
}

export function recordPick(db, row) {
  db.prepare(
    "INSERT OR REPLACE INTO picks (file_id, run_id, parent_id, created_at) VALUES (@file_id, @run_id, @parent_id, @created_at)",
  ).run(row);
}

export function picksForRun(db, runId) {
  return db.prepare("SELECT file_id, run_id, parent_id, created_at FROM picks WHERE run_id = ?").all(runId);
}

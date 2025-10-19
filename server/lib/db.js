import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let dbInstance;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function getDb() {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  return dbInstance;
}

export async function initDb() {
  if (dbInstance) return dbInstance;
  const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '..', '..', 'data.sqlite');
  dbInstance = await open({ filename: dbPath, driver: sqlite3.Database });

  await dbInstance.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS serial_numbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL,
      serial TEXT NOT NULL,
      item_name TEXT,
      item_description TEXT,
      photo_url TEXT,
      public_cid TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (sku, serial)
    );

    CREATE TABLE IF NOT EXISTS unlocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_id INTEGER NOT NULL,
      secret_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      private_cid TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (serial_id) REFERENCES serial_numbers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_id INTEGER NOT NULL,
      owner_name TEXT NOT NULL,
      public_file_url TEXT,
      private_file_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      contested INTEGER DEFAULT 0,
      unlock_id INTEGER,
      FOREIGN KEY (serial_id) REFERENCES serial_numbers(id) ON DELETE CASCADE,
      FOREIGN KEY (unlock_id) REFERENCES unlocks(id) ON DELETE SET NULL
    );
  `);

  // Backfill schema columns if database was created before these fields existed
  try { await dbInstance.exec(`ALTER TABLE serial_numbers ADD COLUMN public_cid TEXT`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE unlocks ADD COLUMN private_cid TEXT`); } catch { }

  return dbInstance;
}



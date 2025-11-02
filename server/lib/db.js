import path from 'path';
import fs from 'fs';
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
  
  // Determine database path based on PERSIST_DIR or SQLITE_PATH
  let dbPath;
  if (process.env.PERSIST_DIR) {
    // Resolve relative to project root (__dirname is server/lib, so ../.. is project root)
    // If PERSIST_DIR is absolute, it will be used as-is; if relative, it's relative to project root
    const persistDir = path.resolve(__dirname, '..', '..', process.env.PERSIST_DIR);
    // Create directory if it doesn't exist
    if (!fs.existsSync(persistDir)) {
      fs.mkdirSync(persistDir, { recursive: true });
    }
    dbPath = path.join(persistDir, 'data.sqlite');
  } else {
    dbPath = process.env.SQLITE_PATH || path.join(__dirname, '..', '..', 'data.sqlite');
  }
  
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
      created_by_email TEXT,
      pending_unlock_id INTEGER,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (sku, serial)
    );

    CREATE TABLE IF NOT EXISTS unlocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_id INTEGER NOT NULL,
      secret_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      private_cid TEXT,
      revoked INTEGER DEFAULT 0,
      revoked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (serial_id) REFERENCES serial_numbers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_id INTEGER NOT NULL,
      owner_name TEXT NOT NULL,
      owner_email TEXT,
      public_file_url TEXT,
      private_file_url TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      contested INTEGER DEFAULT 0,
      contest_reason TEXT,
      unlock_id INTEGER,
      FOREIGN KEY (serial_id) REFERENCES serial_numbers(id) ON DELETE CASCADE,
      FOREIGN KEY (unlock_id) REFERENCES unlocks(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS audit_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      cid TEXT,
      url TEXT,
      ipfs_uri TEXT,
      source TEXT DEFAULT 'manual',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Backfill schema columns if database was created before these fields existed
  try { await dbInstance.exec(`ALTER TABLE serial_numbers ADD COLUMN public_cid TEXT`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE serial_numbers ADD COLUMN created_by_email TEXT`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE registrations ADD COLUMN owner_unlock_id INTEGER`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE serial_numbers ADD COLUMN pending_unlock_id INTEGER`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE unlocks ADD COLUMN private_cid TEXT`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE unlocks ADD COLUMN revoked INTEGER DEFAULT 0`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE unlocks ADD COLUMN revoked_at DATETIME`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE registrations ADD COLUMN contest_reason TEXT`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE registrations ADD COLUMN owner_email TEXT`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE audit_history ADD COLUMN source TEXT DEFAULT 'manual'`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE audit_history ADD COLUMN cid TEXT`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE audit_history ADD COLUMN url TEXT`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE audit_history ADD COLUMN ipfs_uri TEXT`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE audit_history ADD COLUMN stamp_response TEXT`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE serial_numbers ADD COLUMN ip_address TEXT`); } catch { }
  try { await dbInstance.exec(`ALTER TABLE registrations ADD COLUMN ip_address TEXT`); } catch { }

  return dbInstance;
}



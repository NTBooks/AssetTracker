import { getDb } from './db.js';
import { uploadArbitraryFile } from './chainletter.js';

export async function buildAuditPayload() {
  const db = await getDb();
  const serials = await db.all(`
    SELECT id, sku, serial, item_name, item_description, photo_url, public_cid, created_at
    FROM serial_numbers ORDER BY id ASC
  `);
  const registrations = await db.all(`
    SELECT r.id, r.serial_id, s.sku, s.serial, r.owner_name, r.public_file_url, r.private_file_url, r.created_at, r.contested, r.contest_reason
    FROM registrations r
    JOIN serial_numbers s ON s.id = r.serial_id
    ORDER BY r.id ASC
  `);
  const contests = registrations.filter((r) => Number(r.contested) === 1);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      serials: serials.length,
      registrations: registrations.length,
      contests: contests.length,
    },
    serial_numbers: serials,
    public_registrations: registrations.map((r) => ({
      id: r.id,
      serial_id: r.serial_id,
      sku: r.sku,
      serial: r.serial,
      owner_name: r.owner_name,
      public_file_url: r.public_file_url,
      created_at: r.created_at,
      contested: r.contested,
      contest_reason: r.contest_reason || null,
    })),
    contests: contests.map((c) => ({
      id: c.id,
      serial_id: c.serial_id,
      sku: c.sku,
      serial: c.serial,
      owner_name: c.owner_name,
      created_at: c.created_at,
      contest_reason: c.contest_reason || null,
    })),
  };
}

export async function createAuditProof({ source = 'manual', stampImmediately = true } = {}) {
  const payload = await buildAuditPayload();
  const json = JSON.stringify(payload, null, 2);
  const buffer = Buffer.from(json, 'utf8');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `audit-${timestamp}.json`;

  const upload = await uploadArbitraryFile({
    buffer,
    filename,
    contentType: 'application/json',
    visibility: 'public',
    groupName: 'RWA Files (public)',
    stampImmediately,
  });

  if (!upload?.url) {
    throw new Error('Audit proof upload failed');
  }

  const db = await getDb();
  const stampResponseJson = upload?.raw ? JSON.stringify(upload.raw) : null;
  const result = await db.run(
    'INSERT INTO audit_history (filename, cid, url, ipfs_uri, source, stamp_response) VALUES (?, ?, ?, ?, ?, ?)',
    [filename, upload?.cid ?? null, upload?.url ?? null, upload?.ipfsUri ?? null, source, stampResponseJson]
  );
  const record = await db.get(
    'SELECT id, filename, cid, url, ipfs_uri AS ipfsUri, source, stamp_response AS stampResponse, created_at AS createdAt FROM audit_history WHERE id=?',
    [result.lastID]
  );
  // Parse stamp_response JSON if present
  if (record?.stampResponse) {
    try {
      record.stampResponse = JSON.parse(record.stampResponse);
    } catch {
      // Keep as string if parsing fails
    }
  }
  return { record, payload };
}

export async function getAuditHistory() {
  const db = await getDb();
  const rows = await db.all(
    'SELECT id, filename, cid, url, ipfs_uri AS ipfsUri, source, stamp_response AS stampResponse, created_at AS createdAt FROM audit_history ORDER BY created_at DESC'
  );
  // Parse stamp_response JSON for each row
  return rows.map(row => {
    if (row?.stampResponse) {
      try {
        row.stampResponse = JSON.parse(row.stampResponse);
      } catch {
        // Keep as string if parsing fails
      }
    }
    return row;
  });
}

export async function getAuditRecordById(id) {
  const db = await getDb();
  const record = await db.get(
    'SELECT id, filename, cid, url, ipfs_uri AS ipfsUri, source, stamp_response AS stampResponse, created_at AS createdAt FROM audit_history WHERE id=?',
    [id]
  );
  // Parse stamp_response JSON if present
  if (record?.stampResponse) {
    try {
      record.stampResponse = JSON.parse(record.stampResponse);
    } catch {
      // Keep as string if parsing fails
    }
  }
  return record;
}

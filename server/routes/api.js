import { getDb } from '../lib/db.js';
import axios from 'axios';
import { generateSecret, hashSecret, verifySecret } from '../lib/crypto.js';
import { generatePublicCertificateSvg, generatePrivateSaleSvg, generateNextSecretSvg } from '../lib/svg.js';
import { uploadPublicSvg, uploadPrivateSvg, uploadArbitraryFile, getWebhookCredits } from '../lib/chainletter.js';
import { extractCid, resolveIpfsCidToHttp } from '../lib/ipfs.js';
import multer from 'multer';
import { createCheckoutSession } from '../lib/stripe.js';
import { customAlphabet } from 'nanoid';
import { Readable } from 'stream';
import { requireAdmin } from '../lib/workos.js';

const ok = (res, message, data) => res.status(200).json({ status: 'ok', message, data });
const bad = (res, message, code = 400) => res.status(code).json({ status: 'error', message });

export default function registerApiRoutes(app) {
    // Proxy IPFS file via webhook with server-side secret
    app.get('/api/ipfs/:cid', requireAdmin, async (req, res) => {
        try {
            const cid = String(req.params.cid || '');
            if (!/Qm[1-9A-Za-z]{44}/.test(cid)) {
                return res.status(404).send('Not Found');
            }
            const base = ((process.env.CHAINLETTER_BASE || 'https://dev-pinproxy.chaincart.io').trim()).replace(/\/+$/, '');
            const apiKey = process.env.CHAINLETTER_API_KEY;
            const secret = process.env.CHAINLETTER_SECRET_KEY;
            const cookie = process.env.CHAINLETTER_COOKIE;
            if (!apiKey || !secret) {
                return res.status(503).send('Webhook not configured');
            }
            const url = `${base}/ipfs/${encodeURIComponent(apiKey)}/${cid}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
            const upstream = await axios.get(url, {
                headers: {
                    'secret-key': secret,
                    ...(cookie ? { 'Cookie': cookie } : {}),
                },
                responseType: 'stream',
                timeout: 45000,
                validateStatus: () => true,
            });
            if (upstream.status >= 400) {
                return res.status(upstream.status).send(upstream.statusText || 'Error');
            }
            // Content headers: prefer explicit filename query for correct name/type
            const filename = typeof req.query.filename === 'string' ? req.query.filename : undefined;
            let ct = upstream.headers['content-type'];
            let cd = upstream.headers['content-disposition'];
            if (filename) {
                const safeName = filename.replace(/"/g, '');
                cd = `inline; filename="${safeName}"`;
                const lower = safeName.toLowerCase();
                if (lower.endsWith('.svg')) ct = 'image/svg+xml';
                else if (lower.endsWith('.png')) ct = 'image/png';
                else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) ct = 'image/jpeg';
                else if (!ct) ct = 'application/octet-stream';
            } else {
                if (!ct) ct = 'application/octet-stream';
                if (!cd) cd = `inline; filename="${cid}.bin"`;
            }
            res.setHeader('Content-Type', ct);
            res.setHeader('Content-Disposition', cd);
            upstream.data.pipe(res);
        } catch (e) {
            if (!res.headersSent) res.status(500).send('Internal Server Error');
        }
    });
    // Stamps remaining for tenant (uses tenant-level unless group specified via query)
    app.get('/api/stamps', async (req, res) => {
        try {
            const groupName = req.query?.group || undefined;
            const network = req.query?.network || 'public';
            const { credits } = await getWebhookCredits({ groupName, network });
            return ok(res, 'Stamps', { credits });
        } catch (e) {
            return bad(res, e.message);
        }
    });
    // Public config for client
    app.get('/api/config', (req, res) => {
        return ok(res, 'Config', {
            singleSku: process.env.SINGLE_SKU || null,
        });
    });

    const upload = multer({
        limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
        fileFilter: (req, file, cb) => {
            const allowed = ['image/png', 'image/jpeg'];
            if (allowed.includes(file.mimetype)) return cb(null, true);
            return cb(new Error('Only PNG or JPEG images are allowed'));
        }
    });
    // Generate pseudo-random serial number for default SKU (admin-only)
    app.post('/api/generate-serial', requireAdmin, async (req, res) => {
        const rand = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 10);
        const serial = `CL${rand()}`;
        const sku = (process.env.SINGLE_SKU || 'CL1000');
        return ok(res, 'Generated', { sku, serial });
    });

    // Create checkout session (FREEMODE supported)
    app.post('/api/checkout', async (req, res) => {
        try {
            const { successUrl, cancelUrl, description } = req.body || {};
            const session = await createCheckoutSession({ successUrl, cancelUrl, description });
            return ok(res, 'Checkout created', { id: session.id, url: session.url });
        } catch (e) {
            return bad(res, e.message);
        }
    });

    // Create new item (admin-only)
    app.post('/api/items', requireAdmin, async (req, res) => {
        try {
            const sanitize = (v) => typeof v === 'string' ? v.slice(0, 2000) : v;
            const forcedSku = (process.env.SINGLE_SKU || '').trim();
            const sku = forcedSku || sanitize(req.body?.sku);
            const serial = sanitize(req.body?.serial);
            const itemName = sanitize(req.body?.itemName);
            const itemDescription = sanitize(req.body?.itemDescription);
            const photoUrl = sanitize(req.body?.photoUrl);
            if (!sku || !serial) return bad(res, 'Missing sku or serial');
            const createdByEmail = String(req.user?.email || '').slice(0, 320) || null;

            // Prepare Chainletter artifacts first so we only write DB on success
            const secret = await generateSecret();
            const certSvg = generatePublicCertificateSvg({ sku, serial, itemName, itemDescription });
            const saleSvg = generatePrivateSaleSvg({ sku, serial, ownerName: '', nextSecret: secret });
            // Per-network stamp control: default true for single creates; bulk sets last item per network
            const body = req.body || {};
            const stampNowLegacy = typeof body.stampNow !== 'undefined' ? Boolean(body.stampNow) : undefined;
            const stampNowPublic = typeof body.stampNowPublic !== 'undefined'
                ? Boolean(body.stampNowPublic)
                : (typeof stampNowLegacy !== 'undefined' ? stampNowLegacy : true);
            const stampNowPrivate = typeof body.stampNowPrivate !== 'undefined'
                ? Boolean(body.stampNowPrivate)
                : (typeof stampNowLegacy !== 'undefined' ? stampNowLegacy : true);
            let certUpload, saleUpload;
            try {
                // Public certificate (stamp when last public file in series)
                certUpload = await uploadPublicSvg(`certificate-${sku}-${serial}.svg`, certSvg, 'RWA Files (public)', { stampImmediately: stampNowPublic });
                // Private sale document with next secret (stamp when last private file in series)
                saleUpload = await uploadPrivateSvg(`sale-${sku}-${serial}.svg`, saleSvg, 'RWA Files (private)', { stampImmediately: stampNowPrivate });
            } catch (e) {
                const statusCode = e?.response?.status || 502;
                const msg = e?.response?.data?.message || e?.message || 'Chainletter error';
                return res.status(statusCode).json({ status: 'error', message: `Chainletter upload failed: ${msg}` });
            }
            if (!certUpload?.url || !saleUpload?.cid) {
                return bad(res, 'Chainletter upload failed or not configured', 503);
            }

            // Now persist to DB (store only CID for image if an IPFS URI or gateway URL was provided)
            const db = await getDb();
            const photoCid = extractCid(photoUrl);
            await db.run('INSERT INTO serial_numbers (sku, serial, item_name, item_description, photo_url, public_cid, created_by_email) VALUES (?, ?, ?, ?, ?, ?, ?)', [sku, serial, itemName ?? null, itemDescription ?? null, photoCid ?? null, certUpload.cid ?? null, createdByEmail]);
            const serialRow = await db.get('SELECT id FROM serial_numbers WHERE sku=? AND serial=?', [sku, serial]);
            const { hash, salt } = await hashSecret(secret);
            const result = await db.run('INSERT INTO unlocks (serial_id, secret_hash, salt, private_cid) VALUES (?, ?, ?, ?)', [serialRow.id, hash, salt, saleUpload.cid ?? null]);
            const unlockId = result.lastID;

            // Build API-key protected URL for private next-secret SVG via proxy
            // Local proxy URL hides API credentials
            const privateUrl = saleUpload?.cid ? `/api/ipfs/${saleUpload.cid}?filename=${encodeURIComponent(`sale-${sku}-${serial}.svg`)}` : (saleUpload?.url || null);

            return ok(res, 'Item created', {
                sku,
                serial,
                unlockId,
                initialSecret: secret,
                certificateUrl: certUpload.url,
                privateUrl
            });
        } catch (e) {
            if (e?.message?.includes('UNIQUE')) return bad(res, 'Serial already exists');
            return bad(res, e.message);
        }
    });

    // Upload an image as public Chainletter file under RWA Files (public) or private if requested
    app.post('/api/upload-image', requireAdmin, (req, res) => {
        upload.single('image')(req, res, async (err) => {
            if (err) {
                const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 2MB or smaller' : err.message || 'Invalid image upload';
                return res.status(400).json({ status: 'error', message });
            }
            try {
                if (!req.file) return bad(res, 'No file uploaded');
                const isPrivate = String(req.body?.visibility || 'public') === 'private';
                const groupName = isPrivate ? 'RWA Files (private)' : 'RWA Files (public)';
                const { buffer, mimetype, originalname, size } = req.file;
                if (!['image/png', 'image/jpeg'].includes(mimetype)) {
                    return bad(res, 'Only PNG or JPEG images are allowed');
                }
                if (size > 2 * 1024 * 1024) {
                    return bad(res, 'Image must be 2MB or smaller');
                }
                const result = await uploadArbitraryFile({ buffer, filename: originalname, contentType: mimetype, visibility: isPrivate ? 'private' : 'public', groupName });
                return ok(res, 'Uploaded', { url: result?.url ?? null, cid: result?.cid ?? null, ipfsUri: result?.ipfsUri ?? null });
            } catch (e) {
                const statusCode = e?.response?.status || 502;
                const msg = e?.response?.data?.message || e?.message || 'Upload failed';
                return res.status(statusCode).json({ status: 'error', message: `Chainletter upload error: ${msg}` });
            }
        });
    });

    // Register asset by new owner
    app.post('/api/registrations', async (req, res) => {
        try {
            const sanitize = (v) => typeof v === 'string' ? v.slice(0, 2000) : v;
            const forcedSku = (process.env.SINGLE_SKU || '').trim();
            const sku = forcedSku || sanitize(req.body?.sku);
            const serial = sanitize(req.body?.serial);
            const ownerName = sanitize(req.body?.ownerName);
            const unlockSecret = sanitize(req.body?.unlockSecret);
            if (!sku || !serial || !ownerName || !unlockSecret) return bad(res, 'Missing fields');

            const db = await getDb();
            const serialRow = await db.get('SELECT id, item_name, item_description FROM serial_numbers WHERE sku=? AND serial=?', [sku, serial]);
            if (!serialRow) return bad(res, 'Serial not found', 404);
            const lastUnlock = await db.get('SELECT id, secret_hash, revoked FROM unlocks WHERE serial_id=? ORDER BY id DESC LIMIT 1', [serialRow.id]);
            if (!lastUnlock) return bad(res, 'Unlock not found', 404);

            const okSecret = await verifySecret(unlockSecret, lastUnlock.secret_hash);
            if (!okSecret) return bad(res, 'Invalid unlock secret', 403);
            if (Number(lastUnlock.revoked) === 1) return bad(res, 'This transfer has been revoked', 403);

            // Registration now only stamps the public certificate.
            // Transfers that create the next private sale doc are done via /api/transfer.
            const publicSvg = generatePublicCertificateSvg({ sku, serial, itemName: serialRow.item_name, itemDescription: serialRow.item_description });
            let publicUpload;
            try {
                // Public registration is the only/last public upload in this series → stamp now for public
                publicUpload = await uploadPublicSvg(`registration-${sku}-${serial}-${Date.now()}.svg`, publicSvg, 'RWA Files (public)', { stampImmediately: true });
            } catch (e) {
                const statusCode = e?.response?.status || 502;
                const msg = e?.response?.data?.message || e?.message || 'Chainletter error';
                return res.status(statusCode).json({ status: 'error', message: `Chainletter upload failed: ${msg}` });
            }
            if (!publicUpload?.url) {
                return bad(res, 'Chainletter upload failed or not configured', 503);
            }

            // Determine if this is the first registration for this serial
            const countRow = await db.get('SELECT COUNT(1) as c FROM registrations WHERE serial_id=?', [serialRow.id]);
            const isFirst = Number(countRow?.c || 0) === 0;

            // Revoke the secret that was used so it cannot be reused
            await db.run('UPDATE unlocks SET revoked=1, revoked_at=CURRENT_TIMESTAMP WHERE id=?', [lastUnlock.id]);
            // Clear pending if this unlock was a pending transfer
            await db.run('UPDATE serial_numbers SET pending_unlock_id=NULL WHERE id=? AND pending_unlock_id=?', [serialRow.id, lastUnlock.id]);

            // Always issue a brand new next secret for the new owner, but do not start a transfer yet.
            // The sale document is created only when the owner explicitly initiates Transfer.
            const nextSecret = await generateSecret();
            const { hash, salt } = await hashSecret(nextSecret);
            await db.run('INSERT INTO unlocks (serial_id, secret_hash, salt, private_cid) VALUES (?, ?, ?, ?)', [serialRow.id, hash, salt, null]);

            // For first registration, also return a ready-to-download private sale SVG
            // (not uploaded to Chainletter, no pending transfer yet)
            let firstSaleSvg = null;
            let firstSaleFilename = null;
            if (isFirst) {
                firstSaleSvg = generatePrivateSaleSvg({ sku, serial, ownerName, nextSecret });
                firstSaleFilename = `sale-${sku}-${serial}.svg`;
            }

            // Persist the registration referencing the used unlock
            const reg = await db.run('INSERT INTO registrations (serial_id, owner_name, public_file_url, private_file_url, unlock_id) VALUES (?, ?, ?, ?, ?)', [serialRow.id, ownerName, publicUpload.url, null, lastUnlock.id]);

            return ok(res, 'Registered', {
                registrationId: reg.lastID,
                publicUrl: publicUpload.url,
                nextSecret,
                ...(isFirst ? { filename: firstSaleFilename, svg: firstSaleSvg } : {})
            });
        } catch (e) {
            return bad(res, e.message);
        }
    });

    // Create a new private sale document (Transfer) by current owner (latest registrant)
    app.post('/api/transfer', async (req, res) => {
        try {
            const sanitize = (v) => typeof v === 'string' ? v.slice(0, 2000) : v;
            const forcedSku = (process.env.SINGLE_SKU || '').trim();
            const sku = forcedSku || sanitize(req.body?.sku);
            const serial = sanitize(req.body?.serial);
            const secret = sanitize(req.body?.secret);
            const ownerName = sanitize(req.body?.ownerName || '');
            if (!sku || !serial || !secret) return bad(res, 'Missing fields');
            const db = await getDb();
            const serialRow = await db.get('SELECT * FROM serial_numbers WHERE sku=? AND serial=?', [sku, serial]);
            if (!serialRow) return bad(res, 'Serial not found', 404);
            if (serialRow.pending_unlock_id) {
                const pending = await db.get('SELECT revoked FROM unlocks WHERE id=?', [serialRow.pending_unlock_id]);
                if (pending && Number(pending.revoked) !== 1) {
                    return bad(res, 'Transfer already pending. Revoke it before creating a new one.', 409);
                }
            }
            // Verify provided secret corresponds to the newest active (non-revoked) unlock.
            // After first registration, this is the next-secret created for the current owner.
            const lastUnlock = await db.get('SELECT id, secret_hash FROM unlocks WHERE serial_id=? AND COALESCE(revoked,0)=0 ORDER BY id DESC LIMIT 1', [serialRow.id]);
            if (!lastUnlock) return bad(res, 'No active unlock found', 400);
            const okKey = await verifySecret(secret, lastUnlock.secret_hash);
            if (!okKey) return bad(res, 'Invalid key', 403);

            // Upload private sale doc using the current owner's active secret provided here
            const saleSvg = generatePrivateSaleSvg({ sku, serial, ownerName, nextSecret: secret });
            let saleUpload;
            try {
                saleUpload = await uploadPrivateSvg(`sale-${sku}-${serial}.svg`, saleSvg, 'RWA Files (private)', { stampImmediately: true });
            } catch (e) {
                const statusCode = e?.response?.status || 502;
                const msg = e?.response?.data?.message || e?.message || 'Chainletter error';
                return res.status(statusCode).json({ status: 'error', message: `Chainletter upload failed: ${msg}` });
            }
            if (!saleUpload?.cid) return bad(res, 'Upload failed', 502);
            // Attach the sale doc to the existing active unlock and mark as pending
            await db.run('UPDATE unlocks SET private_cid=? WHERE id=?', [saleUpload.cid ?? null, lastUnlock.id]);
            await db.run('UPDATE serial_numbers SET pending_unlock_id=? WHERE id=?', [lastUnlock.id, serialRow.id]);

            return ok(res, 'Transfer created', {
                privateUrl: `/api/ipfs/${saleUpload.cid}?filename=${encodeURIComponent(`sale-${sku}-${serial}.svg`)}`,
                filename: `sale-${sku}-${serial}.svg`,
                svg: saleSvg,
            });
        } catch (e) {
            return bad(res, e.message);
        }
    });

    // Revoke a pending transfer
    app.post('/api/revoke', async (req, res) => {
        try {
            const sanitize = (v) => typeof v === 'string' ? v.slice(0, 2000) : v;
            const forcedSku = (process.env.SINGLE_SKU || '').trim();
            const sku = forcedSku || sanitize(req.body?.sku);
            const serial = sanitize(req.body?.serial);
            const secret = sanitize(req.body?.secret);
            if (!sku || !serial || !secret) return bad(res, 'Missing fields');
            const db = await getDb();
            const serialRow = await db.get('SELECT * FROM serial_numbers WHERE sku=? AND serial=?', [sku, serial]);
            if (!serialRow) return bad(res, 'Serial not found', 404);
            if (!serialRow.pending_unlock_id) return bad(res, 'No pending transfer to revoke', 400);

            // Verify with the current owner's active (non-revoked) registration secret
            const activeUnlock = await db.get('SELECT id, secret_hash FROM unlocks WHERE serial_id=? AND COALESCE(revoked,0)=0 ORDER BY id DESC LIMIT 1', [serialRow.id]);
            if (!activeUnlock) return bad(res, 'No active key for this serial', 400);
            const okKey = await verifySecret(secret, activeUnlock.secret_hash);
            if (!okKey) return bad(res, 'Invalid key', 403);

            // Revoke the pending unlock
            await db.run('UPDATE unlocks SET revoked=1, revoked_at=CURRENT_TIMESTAMP WHERE id=?', [serialRow.pending_unlock_id]);
            await db.run('UPDATE serial_numbers SET pending_unlock_id=NULL WHERE id=?', [serialRow.id]);

            // Create an informational public record (revocation notice)
            const nowIso = new Date().toISOString();
            const message = `Transfer revoked\nSKU: ${sku}\nSerial: ${serial}\nTimestamp: ${nowIso} (UTC)`;
            const buffer = Buffer.from(message, 'utf8');
            const filename = `revoke-${sku}-${serial}-${Date.now()}.txt`;
            const uploaded = await uploadArbitraryFile({ buffer, filename, contentType: 'text/plain', visibility: 'public', groupName: 'RWA Files (public)', stampImmediately: true });

            return ok(res, 'Revoked', { proofCid: uploaded?.cid || null, proofUrl: uploaded?.url || null });
        } catch (e) {
            return bad(res, e.message);
        }
    });

    // Verify page data
    app.get('/api/verify', async (req, res) => {
        try {
            const forcedSku = (process.env.SINGLE_SKU || '').trim();
            const sku = forcedSku || String(req.query?.sku || '');
            const serial = String(req.query?.serial || '');
            const db = await getDb();
            const serialRow = await db.get('SELECT * FROM serial_numbers WHERE sku=? AND serial=?', [sku, serial]);
            if (!serialRow) return ok(res, 'No record', { serial: null, registrations: [] });
            const regs = await db.all('SELECT id, owner_name, created_at, contested, contest_reason, public_file_url FROM registrations WHERE serial_id=? ORDER BY id ASC', [serialRow.id]);
            const serialOut = serialRow ? {
                ...serialRow,
                photo_url: serialRow.photo_url ? resolveIpfsCidToHttp(serialRow.photo_url) : null,
                public_url: serialRow.public_cid ? resolveIpfsCidToHttp(serialRow.public_cid) : null
            } : null;
            return ok(res, 'Found', { serial: serialOut, registrations: regs });
        } catch (e) {
            return bad(res, e.message);
        }
    });

    // Contest a registration
    app.post('/api/contest', async (req, res) => {
        try {
            const sanitize = (v) => typeof v === 'string' ? v.slice(0, 2000) : v;
            const registrationId = Number(req.body?.registrationId);
            const secret = sanitize(req.body?.secret);
            const reasonRaw = String(sanitize(req.body?.reason || 'other')).toLowerCase();
            const allowedReasons = new Set(['lost', 'stolen', 'fraud', 'other']);
            if (!allowedReasons.has(reasonRaw)) {
                return bad(res, 'Invalid reason');
            }
            const reason = reasonRaw;
            if (!registrationId || !secret) return bad(res, 'Missing fields');
            const db = await getDb();
            const reg = await db.get('SELECT id, serial_id FROM registrations WHERE id=?', [registrationId]);
            if (!reg) return bad(res, 'Registration not found', 404);
            // Validate against newest active key for this serial (current owner's key)
            const activeUnlock = await db.get('SELECT id, secret_hash FROM unlocks WHERE serial_id=? AND COALESCE(revoked,0)=0 ORDER BY id DESC LIMIT 1', [reg.serial_id]);
            if (!activeUnlock) return bad(res, 'No active key for this registration', 403);
            const okKey = await verifySecret(secret, activeUnlock.secret_hash);
            if (!okKey) return bad(res, 'Invalid key', 403);
            await db.run('UPDATE registrations SET contested=1, contest_reason=? WHERE id=?', [reason, registrationId]);
            return ok(res, 'Contested');
        } catch (e) {
            return bad(res, e.message);
        }
    });

    // Create public proof text file (stamped immediately)
    app.post('/api/proof', async (req, res) => {
        try {
            const sanitize = (v) => typeof v === 'string' ? v.slice(0, 5000) : v;
            const registrationId = Number(req.body?.registrationId);
            const sku = sanitize(req.body?.sku);
            const serial = sanitize(req.body?.serial);
            const phrase = sanitize(req.body?.phrase);
            const secret = sanitize(req.body?.secret);
            if (!registrationId || !sku || !serial || !phrase || !secret) return bad(res, 'Missing fields');

            const db = await getDb();
            const reg = await db.get('SELECT id, owner_name, unlock_id, created_at, serial_id FROM registrations WHERE id=?', [registrationId]);
            if (!reg) return bad(res, 'Registration not found', 404);
            // Use the newest active (non-revoked) unlock for this serial – current owner's key
            const activeUnlock = await db.get('SELECT id, secret_hash FROM unlocks WHERE serial_id=? AND COALESCE(revoked,0)=0 ORDER BY id DESC LIMIT 1', [reg.serial_id]);
            if (!activeUnlock) return bad(res, 'No active key for this registration', 403);
            const okKey = await verifySecret(secret, activeUnlock.secret_hash);
            if (!okKey) return bad(res, 'Invalid key', 403);

            // Build full registration chain (oldest to newest)
            const regs = await db.all('SELECT id, owner_name, created_at FROM registrations WHERE serial_id=? ORDER BY id ASC', [reg.serial_id]);
            const nowIso = new Date().toISOString();
            let chain = 'Registration Chain (oldest → newest)\n';
            regs.forEach((r, idx) => {
                const marker = Number(r.id) === Number(registrationId) ? '-> ' : '   ';
                chain += `${marker}[${idx + 1}] Owner: ${r.owner_name} • Created At: ${r.created_at} (UTC)\n`;
            });
            const disclaimer = `\nNote: This proof reflects data as of ${nowIso} (UTC). If any transfer or change is being considered, generate a fresh proof to ensure the most current state is captured.\n`;
            const header = `Proof of Registration\nSKU: ${sku}\nSerial: ${serial}\nFocused Registration ID: ${registrationId}\nPhrase: ${phrase}\n`;
            const content = `${header}\n${chain}${disclaimer}`;
            const buffer = Buffer.from(content, 'utf8');
            const filename = `proof-${sku}-${serial}-${Date.now()}.txt`;
            const uploaded = await uploadArbitraryFile({ buffer, filename, contentType: 'text/plain', visibility: 'public', groupName: 'RWA Files (public)', stampImmediately: true });
            if (!uploaded?.cid) return bad(res, 'Upload failed', 502);
            return ok(res, 'Proof created', { cid: uploaded.cid, url: uploaded.url, ipfsUri: uploaded.ipfsUri, text: content });
        } catch (e) {
            const statusCode = e?.response?.status || 500;
            return res.status(statusCode).json({ status: 'error', message: e?.message || 'Failed to create proof' });
        }
    });

    // SSE proxy for Chainletter webhook events
    app.get('/api/events/stream', async (req, res) => {
        try {
            const base = ((process.env.CHAINLETTER_BASE || 'https://dev-pinproxy.chaincart.io').trim()).replace(/\/+$/, '');
            const apiKey = process.env.CHAINLETTER_API_KEY;
            const secret = process.env.CHAINLETTER_SECRET_KEY;
            const cookie = process.env.CHAINLETTER_COOKIE;
            if (!apiKey || !secret) {
                res.status(401).json({ status: 'error', message: 'Missing CHAINLETTER credentials' });
                return;
            }
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders?.();

            const controller = new AbortController();
            const url = `${base}/webhook/${encodeURIComponent(apiKey)}/events/stream`;
            const upstream = await fetch(url, {
                headers: {
                    'secret-key': secret,
                    ...(cookie ? { 'Cookie': cookie } : {})
                },
                signal: controller.signal
            });
            if (!upstream.ok || !upstream.body) {
                res.write(`event: error\n`);
                res.write(`data: ${JSON.stringify({ message: `Upstream error ${upstream.status}` })}\n\n`);
                res.end();
                return;
            }
            const nodeStream = Readable.fromWeb(upstream.body);
            nodeStream.on('error', () => {
                try { res.end(); } catch { }
            });
            req.on('close', () => {
                controller.abort();
                try { nodeStream.destroy(); } catch { }
            });
            nodeStream.pipe(res);
        } catch (e) {
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({ message: e?.message || 'SSE proxy failure' })}\n\n`);
            res.end();
        }
    });

    // Audit log: dump all serial numbers, public registrations, and contests as a JSON file
    app.get('/api/audit', requireAdmin, async (req, res) => {
        try {
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
            const contests = registrations.filter(r => Number(r.contested) === 1);

            const payload = {
                generatedAt: new Date().toISOString(),
                totals: {
                    serials: serials.length,
                    registrations: registrations.length,
                    contests: contests.length
                },
                serial_numbers: serials,
                public_registrations: registrations.map(r => ({
                    id: r.id,
                    serial_id: r.serial_id,
                    sku: r.sku,
                    serial: r.serial,
                    owner_name: r.owner_name,
                    public_file_url: r.public_file_url,
                    created_at: r.created_at,
                    contested: r.contested,
                    contest_reason: r.contest_reason || null
                })),
                contests: contests.map(c => ({
                    id: c.id,
                    serial_id: c.serial_id,
                    sku: c.sku,
                    serial: c.serial,
                    owner_name: c.owner_name,
                    created_at: c.created_at,
                    contest_reason: c.contest_reason || null
                }))
            };

            const filename = `audit-${Date.now()}.json`;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.status(200).send(JSON.stringify(payload, null, 2));
        } catch (e) {
            return bad(res, e.message);
        }
    });
}



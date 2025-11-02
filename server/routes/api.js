import { getDb } from '../lib/db.js';
import axios from 'axios';
import { generateSecret, hashSecret, verifySecret } from '../lib/crypto.js';
import { generatePublicCertificateSvg, generatePrivateSaleSvg, generateNextSecretSvg } from '../lib/svg.js';
import { buildRegistrationHistoryText } from '../lib/history.js';
import { createAuditProof, getAuditHistory } from '../lib/audit.js';
import { uploadPublicSvg, uploadPrivateSvg, uploadArbitraryFile, getWebhookCredits } from '../lib/chainletter.js';
import { extractCid, resolveIpfsCidToHttp } from '../lib/ipfs.js';
import multer from 'multer';
import { createCheckoutSession } from '../lib/stripe.js';
import { customAlphabet } from 'nanoid';
import { Readable } from 'stream';
import { requireAdmin, getUserFromRequest } from '../lib/workos.js';

const ok = (res, message, data) => res.status(200).json({ status: 'ok', message, data });
const bad = (res, message, code = 400) => res.status(code).json({ status: 'error', message });

// Helper function to check if IP logging is enabled
function shouldLogIps() {
    const logIps = process.env.LOG_IPS;
    if (logIps === undefined || logIps === null) return true; // Default to logging if not set
    return String(logIps).toLowerCase() !== 'false';
}

// Helper function to get client IP address from request
function getClientIp(req) {
    if (!shouldLogIps()) return null;
    // Check for forwarded IP (from proxy/load balancer)
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        // x-forwarded-for can contain multiple IPs, take the first one
        const ips = forwarded.split(',').map(ip => ip.trim());
        return ips[0] || null;
    }
    // Check req.ip (if Express trust proxy is configured)
    if (req.ip) {
        return req.ip;
    }
    // Fallback to connection remote address
    return req.connection?.remoteAddress || req.socket?.remoteAddress || null;
}

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
        const reasons = String(process.env.CONTEST_REASONS || 'lost,stolen,fraud,other')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        return ok(res, 'Config', {
            singleSku: process.env.SINGLE_SKU || null,
            contestReasons: reasons,
            clTenant: process.env.CL_TENANT || 'lakeview.chaincart.io',
            ipfsGateway: process.env.IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/:cid',
            hideLogin: String(process.env.HIDE_LOGIN || '').toLowerCase() === 'true',
            timestampLink: process.env.TIMESTAMP_LINK || '',
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
            const historyText = buildRegistrationHistoryText({ sku, serial, registrations: [], phrase: 'N/A' });
            const certSvg = generatePublicCertificateSvg({ sku, serial, itemName, itemDescription, ownerName: '', historyText });
            const saleSvg = generatePrivateSaleSvg({ sku, serial, ownerName: '', nextSecret: secret, historyText });
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
            const clientIp = getClientIp(req);
            await db.run('INSERT INTO serial_numbers (sku, serial, item_name, item_description, photo_url, public_cid, created_by_email, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [sku, serial, itemName ?? null, itemDescription ?? null, photoCid ?? null, certUpload.cid ?? null, createdByEmail, clientIp]);
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
            const existingRegs = await db.all('SELECT id, owner_name, created_at FROM registrations WHERE serial_id=? ORDER BY id ASC', [serialRow.id]);

            let ownerEmail = null;
            try { ownerEmail = (await getUserFromRequest(req))?.email || null; } catch { }

            let nextSecret;
            let historyText;
            let publicUpload;
            let registrationId;
            let privateSaleSvg;
            let privateSaleFilename;
            let committed = false;

            await db.run('BEGIN');
            try {
                // Revoke the secret that was used so it cannot be reused
                await db.run('UPDATE unlocks SET revoked=1, revoked_at=CURRENT_TIMESTAMP WHERE id=?', [lastUnlock.id]);
                // Clear pending if this unlock was a pending transfer
                await db.run('UPDATE serial_numbers SET pending_unlock_id=NULL WHERE id=? AND pending_unlock_id=?', [serialRow.id, lastUnlock.id]);

                // Always issue a brand new next secret for the new owner, but do not start a transfer yet.
                nextSecret = await generateSecret();
                const { hash, salt } = await hashSecret(nextSecret);
                const ownerUnlockInsert = await db.run('INSERT INTO unlocks (serial_id, secret_hash, salt, private_cid) VALUES (?, ?, ?, ?)', [serialRow.id, hash, salt, null]);
                const ownerUnlockId = ownerUnlockInsert.lastID;

                // Insert the registration now (public file URL updated after successful upload)
                // unlock_id = secret used to unlock/register, owner_unlock_id = secret generated for the owner (for proofs/reports)
                const clientIp = getClientIp(req);
                const regInsert = await db.run('INSERT INTO registrations (serial_id, owner_name, owner_email, public_file_url, private_file_url, unlock_id, owner_unlock_id, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [serialRow.id, ownerName, ownerEmail, null, null, lastUnlock.id, ownerUnlockId, clientIp]);
                registrationId = regInsert.lastID;

                const registrations = await db.all('SELECT id, owner_name, created_at FROM registrations WHERE serial_id=? ORDER BY id ASC', [serialRow.id]);
                historyText = buildRegistrationHistoryText({ sku, serial, registrations, focusedRegistrationId: registrationId, phrase: 'N/A' });

                const publicSvg = generatePublicCertificateSvg({ sku, serial, itemName: serialRow.item_name, itemDescription: serialRow.item_description, ownerName, historyText });
                // Public registration is the only/last public upload in this series → stamp now for public
                publicUpload = await uploadPublicSvg(`registration-${sku}-${serial}-${Date.now()}.svg`, publicSvg, 'RWA Files (public)', { stampImmediately: true });
                if (!publicUpload?.url) {
                    throw new Error('Chainletter upload failed or not configured');
                }

                await db.run('UPDATE registrations SET public_file_url=? WHERE id=?', [publicUpload.url, registrationId]);

                // Always generate a private sale SVG with the new secret for the new owner
                // This ensures the new owner receives a document with their registration secret
                // that only they know (the transfer secret is consumed and Owner A never sees this new secret)
                privateSaleSvg = generatePrivateSaleSvg({ sku, serial, ownerName, nextSecret, historyText });
                privateSaleFilename = `sale-${sku}-${serial}.svg`;

                await db.run('COMMIT');
                committed = true;
            } catch (err) {
                if (!committed) {
                    try { await db.run('ROLLBACK'); } catch { }
                }
                if (err?.response) {
                    const statusCode = err?.response?.status || 502;
                    const msg = err?.response?.data?.message || err?.message || 'Chainletter error';
                    return res.status(statusCode).json({ status: 'error', message: `Chainletter upload failed: ${msg}` });
                }
                if (err?.message === 'Chainletter upload failed or not configured') {
                    return res.status(503).json({ status: 'error', message: err.message });
                }
                throw err;
            }

            return ok(res, 'Registered', {
                registrationId,
                publicUrl: publicUpload.url,
                nextSecret,
                filename: privateSaleFilename,
                svg: privateSaleSvg
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

            // Generate a NEW secret specifically for this transfer
            // This secret will be used by Owner B to complete the transfer
            // If the transfer is revoked, this secret (not Owner A's current secret) will be revoked
            const transferSecret = await generateSecret();
            const { hash: transferSecretHash, salt: transferSecretSalt } = await hashSecret(transferSecret);

            // Create a new unlock record for the transfer secret
            const transferUnlockInsert = await db.run('INSERT INTO unlocks (serial_id, secret_hash, salt, private_cid) VALUES (?, ?, ?, ?)', [serialRow.id, transferSecretHash, transferSecretSalt, null]);
            const transferUnlockId = transferUnlockInsert.lastID;

            // Upload private sale doc with the NEW transfer secret
            // Note: Both Owner A and Owner B will know this transfer secret since Owner A sends the document to Owner B
            // Owner B will receive a NEW registration secret when they complete registration (only they will know it)
            const registrations = await db.all('SELECT id, owner_name, created_at FROM registrations WHERE serial_id=? ORDER BY id ASC', [serialRow.id]);
            const focusId = registrations.length ? registrations[registrations.length - 1].id : null;
            const historyText = buildRegistrationHistoryText({ sku, serial, registrations, focusedRegistrationId: focusId, phrase: 'N/A' });
            const saleSvg = generatePrivateSaleSvg({ sku, serial, ownerName, nextSecret: transferSecret, historyText });
            let saleUpload;
            try {
                saleUpload = await uploadPrivateSvg(`sale-${sku}-${serial}.svg`, saleSvg, 'RWA Files (private)', { stampImmediately: true });
            } catch (e) {
                const statusCode = e?.response?.status || 502;
                const msg = e?.response?.data?.message || e?.message || 'Chainletter error';
                return res.status(statusCode).json({ status: 'error', message: `Chainletter upload failed: ${msg}` });
            }
            if (!saleUpload?.cid) return bad(res, 'Upload failed', 502);
            // Attach the sale doc to the NEW transfer unlock and mark as pending
            await db.run('UPDATE unlocks SET private_cid=? WHERE id=?', [saleUpload.cid ?? null, transferUnlockId]);
            await db.run('UPDATE serial_numbers SET pending_unlock_id=? WHERE id=?', [transferUnlockId, serialRow.id]);

            // Attach email to latest registration if missing and user is logged in
            const latestReg = await db.get('SELECT id, owner_email FROM registrations WHERE serial_id=? ORDER BY id DESC LIMIT 1', [serialRow.id]);
            if (latestReg && !latestReg.owner_email) {
                const u = await getUserFromRequest(req);
                if (u?.email) {
                    await db.run('UPDATE registrations SET owner_email=? WHERE id=?', [u.email, latestReg.id]);
                }
            }

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
            // Exclude the pending unlock (transfer secret) - we want Owner A's original secret
            const activeUnlock = await db.get('SELECT id, secret_hash FROM unlocks WHERE serial_id=? AND COALESCE(revoked,0)=0 AND id!=? ORDER BY id DESC LIMIT 1', [serialRow.id, serialRow.pending_unlock_id]);
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
            const allowedReasons = new Set(
                String(process.env.CONTEST_REASONS || 'lost,stolen,fraud,other')
                    .toLowerCase()
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean)
            );
            if (!allowedReasons.has(reasonRaw)) {
                return bad(res, 'Invalid reason');
            }
            const reason = reasonRaw;
            if (!registrationId || !secret) return bad(res, 'Missing fields');
            const db = await getDb();
            const reg = await db.get('SELECT id, serial_id, unlock_id, owner_unlock_id, owner_email FROM registrations WHERE id=?', [registrationId]);
            if (!reg) return bad(res, 'Registration not found', 404);
            // Contests/reports must use the secret that was generated for the owner when they registered
            // This is the owner_unlock_id (the nextSecret given to the owner), not the unlock_id (transfer/initial secret)
            let ownerUnlock = null;
            if (reg.owner_unlock_id) {
                ownerUnlock = await db.get('SELECT id, secret_hash FROM unlocks WHERE id=?', [reg.owner_unlock_id]);
            } else {
                // Fallback for old registrations: find the unlock created right after this registration's unlock_id
                // This should be the nextSecret that was generated for the owner
                ownerUnlock = await db.get('SELECT id, secret_hash FROM unlocks WHERE serial_id=? AND id > ? ORDER BY id ASC LIMIT 1', [reg.serial_id, reg.unlock_id]);
            }
            if (!ownerUnlock) return bad(res, 'Owner unlock not found', 403);
            const okKey = await verifySecret(secret, ownerUnlock.secret_hash);
            if (!okKey) return bad(res, 'Invalid key', 403);
            if (!reg.owner_email) {
                const u = await getUserFromRequest(req);
                if (u?.email) {
                    await db.run('UPDATE registrations SET owner_email=? WHERE id=?', [u.email, reg.id]);
                }
            }
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
            const reg = await db.get('SELECT id, owner_name, unlock_id, owner_unlock_id, owner_email, created_at, serial_id FROM registrations WHERE id=?', [registrationId]);
            if (!reg) return bad(res, 'Registration not found', 404);
            // Proofs must use the secret that was generated for the owner when they registered
            // This is the owner_unlock_id (the nextSecret given to the owner), not the unlock_id (transfer/initial secret)
            let ownerUnlock = null;
            if (reg.owner_unlock_id) {
                ownerUnlock = await db.get('SELECT id, secret_hash FROM unlocks WHERE id=?', [reg.owner_unlock_id]);
            } else {
                // Fallback for old registrations: find the unlock created right after this registration's unlock_id
                // This should be the nextSecret that was generated for the owner
                ownerUnlock = await db.get('SELECT id, secret_hash FROM unlocks WHERE serial_id=? AND id > ? ORDER BY id ASC LIMIT 1', [reg.serial_id, reg.unlock_id]);
            }
            if (!ownerUnlock) return bad(res, 'Owner unlock not found', 403);
            const okKey = await verifySecret(secret, ownerUnlock.secret_hash);
            if (!okKey) return bad(res, 'Invalid key', 403);

            // Attach current user's email to registration if not set
            if (!reg.owner_email) {
                const u = await getUserFromRequest(req);
                if (u?.email) {
                    await db.run('UPDATE registrations SET owner_email=? WHERE id=?', [u.email, reg.id]);
                }
            }

            // Build full registration chain (oldest to newest)
            const regs = await db.all('SELECT id, owner_name, created_at FROM registrations WHERE serial_id=? ORDER BY id ASC', [reg.serial_id]);
            const content = buildRegistrationHistoryText({ sku, serial, registrations: regs, focusedRegistrationId: registrationId, phrase });
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

    // Audit history and generation
    app.get('/api/audit', requireAdmin, async (req, res) => {
        try {
            const history = await getAuditHistory();
            return ok(res, 'Audit history', { history });
        } catch (e) {
            return bad(res, e.message || 'Failed to load audit history');
        }
    });

    app.post('/api/audit/generate', requireAdmin, async (req, res) => {
        try {
            const { record } = await createAuditProof({ source: 'manual' });
            return ok(res, 'Audit generated', { audit: record });
        } catch (e) {
            const status = e?.response?.status || 500;
            return res.status(status).json({ status: 'error', message: e?.message || 'Failed to generate audit' });
        }
    });
}



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
    app.get('/api/ipfs/:cid', async (req, res) => {
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
    app.post('/api/upload-image', (req, res) => {
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
            const lastUnlock = await db.get('SELECT id, secret_hash FROM unlocks WHERE serial_id=? ORDER BY id DESC LIMIT 1', [serialRow.id]);
            if (!lastUnlock) return bad(res, 'Unlock not found', 404);

            const okSecret = await verifySecret(unlockSecret, lastUnlock.secret_hash);
            if (!okSecret) return bad(res, 'Invalid unlock secret', 403);

            // Create new secret for next transfer and upload Chainletter artifacts first
            const nextSecret = await generateSecret();
            const saleSvg = generatePrivateSaleSvg({ sku, serial, ownerName, nextSecret });
            const publicSvg = generatePublicCertificateSvg({ sku, serial, itemName: serialRow.item_name, itemDescription: serialRow.item_description });
            let saleUpload, publicUpload;
            try {
                // Private sale doc is the only private upload in this series → stamp now for private
                saleUpload = await uploadPrivateSvg(`sale-${sku}-${serial}.svg`, saleSvg, 'RWA Files (private)', { stampImmediately: true });
                // Public registration is the only/last public upload in this series → stamp now for public
                publicUpload = await uploadPublicSvg(`registration-${sku}-${serial}-${Date.now()}.svg`, publicSvg, 'RWA Files (public)', { stampImmediately: true });
            } catch (e) {
                const statusCode = e?.response?.status || 502;
                const msg = e?.response?.data?.message || e?.message || 'Chainletter error';
                return res.status(statusCode).json({ status: 'error', message: `Chainletter upload failed: ${msg}` });
            }
            if (!saleUpload?.cid || !publicUpload?.url) {
                return bad(res, 'Chainletter upload failed or not configured', 503);
            }

            // After successful uploads, persist DB unlock and registration
            const { hash, salt } = await hashSecret(nextSecret);
            const insertUnlock = await db.run('INSERT INTO unlocks (serial_id, secret_hash, salt, private_cid) VALUES (?, ?, ?, ?)', [serialRow.id, hash, salt, saleUpload.cid ?? null]);
            const reg = await db.run('INSERT INTO registrations (serial_id, owner_name, public_file_url, private_file_url, unlock_id) VALUES (?, ?, ?, ?, ?)', [serialRow.id, ownerName, publicUpload.url, saleUpload.url, insertUnlock.lastID]);

            return ok(res, 'Registered', {
                registrationId: reg.lastID,
                publicUrl: publicUpload.url,
                privateUrl: `/api/ipfs/${saleUpload.cid}?filename=${encodeURIComponent(`sale-${sku}-${serial}.svg`)}`,
                nextSecret
            });
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
            const reason = sanitize(req.body?.reason || 'other');
            if (!registrationId || !secret) return bad(res, 'Missing fields');
            const db = await getDb();
            const reg = await db.get('SELECT id, unlock_id FROM registrations WHERE id=?', [registrationId]);
            if (!reg) return bad(res, 'Registration not found', 404);
            const unlock = await db.get('SELECT secret_hash FROM unlocks WHERE id=?', [reg.unlock_id]);
            if (!unlock) return bad(res, 'Unlock not found', 404);
            const okKey = await verifySecret(secret, unlock.secret_hash);
            if (!okKey) return bad(res, 'Invalid key', 403);
            await db.run('UPDATE registrations SET contested=1, contest_reason=? WHERE id=?', [reason, registrationId]);
            return ok(res, 'Contested');
        } catch (e) {
            return bad(res, e.message);
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
    app.get('/api/audit', async (req, res) => {
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



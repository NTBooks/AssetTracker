import { getDb } from '../lib/db.js';
import { generateSecret, hashSecret, verifySecret } from '../lib/crypto.js';
import { generatePublicCertificateSvg, generatePrivateSaleSvg, generateNextSecretSvg } from '../lib/svg.js';
import { uploadPublicSvg, uploadPrivateSvg, uploadArbitraryFile } from '../lib/chainletter.js';
import { extractCid, resolveIpfsCidToHttp } from '../lib/ipfs.js';
import multer from 'multer';
import { createCheckoutSession } from '../lib/stripe.js';
import { nanoid } from 'nanoid';
import { Readable } from 'stream';

const ok = (res, message, data) => res.status(200).json({ status: 'ok', message, data });
const bad = (res, message, code = 400) => res.status(code).json({ status: 'error', message });

export default function registerApiRoutes(app) {
    const upload = multer({
        limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
        fileFilter: (req, file, cb) => {
            const allowed = ['image/png', 'image/jpeg'];
            if (allowed.includes(file.mimetype)) return cb(null, true);
            return cb(new Error('Only PNG or JPEG images are allowed'));
        }
    });
    // Generate pseudo-random serial number for default SKU
    app.post('/api/generate-serial', async (req, res) => {
        const serial = `CL-${nanoid(10).toUpperCase()}`;
        return ok(res, 'Generated', { sku: 'CL1000', serial });
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

    // Create new item (after payment success)
    app.post('/api/items', async (req, res) => {
        try {
            const sanitize = (v) => typeof v === 'string' ? v.slice(0, 2000) : v;
            const sku = sanitize(req.body?.sku);
            const serial = sanitize(req.body?.serial);
            const itemName = sanitize(req.body?.itemName);
            const itemDescription = sanitize(req.body?.itemDescription);
            const photoUrl = sanitize(req.body?.photoUrl);
            if (!sku || !serial) return bad(res, 'Missing sku or serial');

            // Prepare Chainletter artifacts first so we only write DB on success
            const secret = await generateSecret();
            const certSvg = generatePublicCertificateSvg({ sku, serial, itemName, itemDescription });
            const nextSvg = generateNextSecretSvg({ sku, serial, nextSecret: secret });
            let certUpload, nextUpload;
            try {
                certUpload = await uploadPublicSvg(`certificate-${sku}-${serial}.svg`, certSvg);
                nextUpload = await uploadPublicSvg(`next-secret-${sku}-${serial}.svg`, nextSvg);
            } catch (e) {
                const statusCode = e?.response?.status || 502;
                const msg = e?.response?.data?.message || e?.message || 'Chainletter error';
                return res.status(statusCode).json({ status: 'error', message: `Chainletter upload failed: ${msg}` });
            }
            if (!certUpload?.url || !nextUpload?.url) {
                return bad(res, 'Chainletter upload failed or not configured', 503);
            }

            // Now persist to DB (store only CID for image if an IPFS URI or gateway URL was provided)
            const db = await getDb();
            const photoCid = extractCid(photoUrl);
            await db.run('INSERT INTO serial_numbers (sku, serial, item_name, item_description, photo_url, public_cid) VALUES (?, ?, ?, ?, ?, ?)', [sku, serial, itemName ?? null, itemDescription ?? null, photoCid ?? null, certUpload.cid ?? null]);
            const serialRow = await db.get('SELECT id FROM serial_numbers WHERE sku=? AND serial=?', [sku, serial]);
            const { hash, salt } = await hashSecret(secret);
            const result = await db.run('INSERT INTO unlocks (serial_id, secret_hash, salt) VALUES (?, ?, ?)', [serialRow.id, hash, salt]);
            const unlockId = result.lastID;

            return ok(res, 'Item created', {
                sku,
                serial,
                unlockId,
                initialSecret: secret,
                certificateUrl: certUpload.url,
                nextSecretUrl: nextUpload.url
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
                const groupName = isPrivate ? 'REW Files (private)' : 'RWA Files (public)';
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
            const sku = sanitize(req.body?.sku);
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
                saleUpload = await uploadPrivateSvg(`sale-${sku}-${serial}.svg`, saleSvg);
                publicUpload = await uploadPublicSvg(`registration-${sku}-${serial}-${Date.now()}.svg`, publicSvg);
            } catch (e) {
                const statusCode = e?.response?.status || 502;
                const msg = e?.response?.data?.message || e?.message || 'Chainletter error';
                return res.status(statusCode).json({ status: 'error', message: `Chainletter upload failed: ${msg}` });
            }
            if (!saleUpload?.url || !publicUpload?.url) {
                return bad(res, 'Chainletter upload failed or not configured', 503);
            }

            // After successful uploads, persist DB unlock and registration
            const { hash, salt } = await hashSecret(nextSecret);
            const insertUnlock = await db.run('INSERT INTO unlocks (serial_id, secret_hash, salt, private_cid) VALUES (?, ?, ?, ?)', [serialRow.id, hash, salt, saleUpload.cid ?? null]);
            const reg = await db.run('INSERT INTO registrations (serial_id, owner_name, public_file_url, private_file_url, unlock_id) VALUES (?, ?, ?, ?, ?)', [serialRow.id, ownerName, publicUpload.url, saleUpload.url, insertUnlock.lastID]);

            return ok(res, 'Registered', {
                registrationId: reg.lastID,
                publicUrl: publicUpload.url,
                privateUrl: saleUpload.url,
                nextSecret
            });
        } catch (e) {
            return bad(res, e.message);
        }
    });

    // Verify page data
    app.get('/api/verify', async (req, res) => {
        try {
            const sku = String(req.query?.sku || '');
            const serial = String(req.query?.serial || '');
            const db = await getDb();
            const serialRow = await db.get('SELECT * FROM serial_numbers WHERE sku=? AND serial=?', [sku, serial]);
            if (!serialRow) return ok(res, 'No record', { serial: null, registrations: [] });
            const regs = await db.all('SELECT id, owner_name, created_at, contested, public_file_url FROM registrations WHERE serial_id=? ORDER BY id ASC', [serialRow.id]);
            const serialOut = serialRow ? { ...serialRow, photo_url: serialRow.photo_url ? resolveIpfsCidToHttp(serialRow.photo_url) : null } : null;
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
            if (!registrationId || !secret) return bad(res, 'Missing fields');
            const db = await getDb();
            const reg = await db.get('SELECT id, unlock_id FROM registrations WHERE id=?', [registrationId]);
            if (!reg) return bad(res, 'Registration not found', 404);
            const unlock = await db.get('SELECT secret_hash FROM unlocks WHERE id=?', [reg.unlock_id]);
            if (!unlock) return bad(res, 'Unlock not found', 404);
            const okKey = await verifySecret(secret, unlock.secret_hash);
            if (!okKey) return bad(res, 'Invalid key', 403);
            await db.run('UPDATE registrations SET contested=1 WHERE id=?', [registrationId]);
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
}



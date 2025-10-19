import axios from 'axios';
import FormData from 'form-data';
import dotenv from 'dotenv';
dotenv.config();

const BASE = (((process.env.CHAINLETTER_BASE || '').trim()) || 'https://dev-pinproxy.chaincart.io').replace(/\/+$/, '');
const IPFS_GATEWAY = (process.env.IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/:cid');

function apiClient() {
    return axios.create({ baseURL: BASE, timeout: 30000 });
}


function normalizeUploadResponse(res) {
    const data = res?.data ?? {};
    // Per spec, hash is the IPFS CID
    const cid = data.hash || data.cid || data.data?.cid || null;
    const ipfsUri = cid ? `ipfs://${cid}` : null;
    const url = cid ? IPFS_GATEWAY.replace(':cid', cid) : null;
    return { url, cid, ipfsUri, raw: data };
}

export async function uploadPublicSvg(filename, svgString, groupName = 'RWA Files (public)') {
    const apiKey = process.env.CHAINLETTER_API_KEY;
    const secret = process.env.CHAINLETTER_SECRET_KEY;
    const cookie = process.env.CHAINLETTER_COOKIE;
    if (!apiKey || !secret) return { url: null };
    const client = apiClient();
    const form = new FormData();
    form.append('file', Buffer.from(svgString), { filename, contentType: 'image/svg+xml' });
    const res = await client.post(`/webhook/${encodeURIComponent(apiKey)}`, form, {
        headers: {
            ...form.getHeaders?.(),
            'secret-key': secret,
            'group-id': groupName,
            'network': 'public',
            ...(cookie ? { 'Cookie': cookie } : {})
        }
    });
    return normalizeUploadResponse(res);
}

export async function uploadPrivateSvg(filename, svgString, groupName = 'RWA Files (private)') {
    const apiKey = process.env.CHAINLETTER_API_KEY;
    const secret = process.env.CHAINLETTER_SECRET_KEY;
    const cookie = process.env.CHAINLETTER_COOKIE;
    if (!apiKey || !secret) return { url: null };
    const client = apiClient();
    const form = new FormData();
    form.append('file', Buffer.from(svgString), { filename, contentType: 'image/svg+xml' });
    const res = await client.post(`/webhook/${encodeURIComponent(apiKey)}`, form, {
        headers: {
            ...form.getHeaders?.(),
            'secret-key': secret,
            'group-id': groupName,
            'network': 'private',
            ...(cookie ? { 'Cookie': cookie } : {})
        }
    });
    return normalizeUploadResponse(res);
}

export async function createPublicRegistrationNote(title, description) {
    // Not used with webhook spec; public registration is an uploaded SVG file
    return { url: null };
}

export async function uploadArbitraryFile({ buffer, filename, contentType, visibility = 'public', groupName = 'RWA Files (public)' }) {
    const apiKey = process.env.CHAINLETTER_API_KEY;
    const secret = process.env.CHAINLETTER_SECRET_KEY;
    const cookie = process.env.CHAINLETTER_COOKIE;
    if (!apiKey || !secret) return { url: null };
    const client = apiClient();
    const form = new FormData();
    form.append('file', buffer, { filename, contentType });
    const res = await client.post(`/webhook/${encodeURIComponent(apiKey)}`, form, {
        headers: {
            ...form.getHeaders?.(),
            'secret-key': secret,
            'group-id': groupName,
            'network': visibility,
            ...(cookie ? { 'Cookie': cookie } : {})
        }
    });
    return normalizeUploadResponse(res);
}



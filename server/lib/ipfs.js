const DEFAULT_GATEWAY = (process.env.IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/:cid').trim();

export function resolveIpfsCidToHttp(cid) {
    if (!cid) return null;
    return DEFAULT_GATEWAY.replace(':cid', cid);
}

export function extractCid(input) {
    if (!input) return null;
    // ipfs://<cid>
    const ipfsMatch = String(input).match(/^ipfs:\/\/([^/?#]+)/i);
    if (ipfsMatch) return ipfsMatch[1];
    // https://.../ipfs/<cid>/...
    const pathMatch = String(input).match(/\/ipfs\/([^/?#]+)/i);
    if (pathMatch) return pathMatch[1];
    // raw CID string
    if (/^[a-z0-9]{46,}$/i.test(String(input))) return String(input);
    return null;
}



const DEFAULT_GATEWAY =
  (import.meta.env.VITE_IPFS_GATEWAY as string) ??
  "https://gateway.pinata.cloud/ipfs/:cid";

export function resolveIpfsCidToHttp(cid: string): string | null {
  if (!cid) return null;
  return DEFAULT_GATEWAY.replace(":cid", cid);
}

export function resolveIpfsThumb(
  cid: string,
  _size: number = 300
): string | null {
  const base = resolveIpfsCidToHttp(cid);
  if (!base) return null;
  return base;
}

export function toThumbFromUrlOrCid(
  urlOrCid?: string | null,
  _size: number = 300
): string | null {
  if (!urlOrCid) return null;
  if (/^https?:\/\//i.test(urlOrCid)) {
    return urlOrCid;
  }
  return resolveIpfsThumb(urlOrCid, _size);
}

export function extractCidFromUrlOrString(
  input?: string | null
): string | null {
  if (!input) return null;
  const ipfsUri = input.match(/^ipfs:\/\/([A-Za-z0-9]+)$/i);
  if (ipfsUri) return ipfsUri[1];
  const inPath = input.match(/\bipfs\/[A-Za-z0-9]+/i);
  if (inPath) return inPath[0].split("/").pop() || null;
  if (/^[A-Za-z0-9]+$/.test(input)) return input;
  return null;
}

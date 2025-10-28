const DEFAULT_GATEWAY =
  (import.meta.env.VITE_IPFS_GATEWAY as string) ??
  "https://gateway.pinata.cloud/ipfs/:cid";

export function resolveIpfsCidToHttp(cid: string): string | null {
  if (!cid) return null;
  return DEFAULT_GATEWAY.replace(":cid", cid);
}

export function resolveIpfsThumb(
  cid: string,
  size: number = 300
): string | null {
  const base = resolveIpfsCidToHttp(cid);
  if (!base) return null;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}img-width=${size}`;
}

export function toThumbFromUrlOrCid(
  urlOrCid?: string | null,
  size: number = 300
): string | null {
  if (!urlOrCid) return null;
  // If already an http(s) URL, just append width param
  if (/^https?:\/\//i.test(urlOrCid)) {
    const sep = urlOrCid.includes("?") ? "&" : "?";
    return `${urlOrCid}${sep}img-width=${size}`;
  }
  // Otherwise treat as CID
  return resolveIpfsThumb(urlOrCid, size);
}

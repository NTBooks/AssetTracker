const DEFAULT_GATEWAY = "https://gateway.pinata.cloud/ipfs/:cid";

export function resolveIpfsCidToHttp(
  cid: string,
  gateway?: string
): string | null {
  if (!cid) return null;
  const gate = gateway || DEFAULT_GATEWAY;
  return gate.replace(":cid", cid);
}

export function resolveIpfsThumb(
  cid: string,
  _size: number = 300,
  gateway?: string
): string | null {
  const base = resolveIpfsCidToHttp(cid, gateway);
  if (!base) return null;
  return base;
}

export function toThumbFromUrlOrCid(
  urlOrCid?: string | null,
  _size: number = 300,
  gateway?: string
): string | null {
  if (!urlOrCid) return null;
  if (/^https?:\/\//i.test(urlOrCid)) {
    return urlOrCid;
  }
  return resolveIpfsThumb(urlOrCid, _size, gateway);
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

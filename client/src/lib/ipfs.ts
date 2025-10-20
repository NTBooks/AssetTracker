const DEFAULT_GATEWAY =
  (import.meta.env.VITE_IPFS_GATEWAY as string) ??
  "https://gateway.pinata.cloud/ipfs/:cid";

export function resolveIpfsCidToHttp(cid: string): string | null {
  if (!cid) return null;
  return DEFAULT_GATEWAY.replace(":cid", cid);
}

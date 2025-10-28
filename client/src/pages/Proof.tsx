import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ClvTag } from "../lib/clv";

export default function Proof() {
  const location = useLocation();
  const [cid, setCid] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    setCid(p.get("cid"));
  }, [location.search]);
  const shareUrl = cid
    ? `${window.location.origin}/proof?cid=${encodeURIComponent(cid)}`
    : "";
  return (
    <div className="card p-6">
      <h2 className="text-xl font-semibold mb-2">Proof</h2>
      {cid ? (
        <div className="space-y-2">
          <div className="text-sm text-stone-600">CID: {cid}</div>
          <ClvTag cid={cid} />
          <div className="flex items-center gap-2">
            <input className="input flex-1" readOnly value={shareUrl} />
            <button
              className="btn-outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {}
              }}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-sm text-stone-600">
            Note: It can take a few minutes for verification to be committed to
            the blockchain. If the tag does not show verified immediately,
            please check back shortly.
          </p>
        </div>
      ) : (
        <div className="text-stone-600">No CID provided.</div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { createCheckout, registerAsset } from "../lib/api";
import { addRecentItem } from "../lib/recent";
import { TESTMODE } from "../lib/env";
import { useConfig } from "../lib/config";

export default function RegisterAsset() {
  const location = useLocation();
  const { singleSku } = useConfig();
  const [sku, setSku] = useState("");
  const [serial, setSerial] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [unlockSecret, setUnlockSecret] = useState("");
  const [result, setResult] = useState<any>(null);
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [copied, setCopied] = useState(false);
  // Prefill from query params if present
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const s = singleSku || params.get("sku") || "";
    const sn = params.get("serial") || "";
    if (s) setSku(s);
    if (sn) setSerial(sn);
  }, [location.search]);
  const [error, setError] = useState<string | null>(null);

  const labelClass =
    "block text-xs font-semibold tracking-[0.08em] uppercase text-slate-600 mb-2";

  const onRegister = async () => {
    const successUrl = window.location.origin + "/register?status=paid";
    const cancelUrl = window.location.href;
    try {
      const checkout = await createCheckout(
        "Ownership registration",
        successUrl,
        cancelUrl
      );
      if (checkout.id !== "free_mode") {
        window.location.href = checkout.url;
        return;
      }
      const data = await registerAsset({
        sku: singleSku || sku,
        serial,
        ownerName,
        unlockSecret,
      });
      if (data?.svg) {
        const filename =
          data.filename || `sale-${singleSku || sku}-${serial}.svg`;
        const blob = new Blob([data.svg], {
          type: "image/svg+xml;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      setResult(data);
      setShowSecretModal(Boolean(data?.nextSecret));
      addRecentItem({
        sku: singleSku || sku,
        serial,
        itemName: ownerName,
        secret: data.nextSecret,
        kind: "registered",
      });
      setError(null);
    } catch (e: any) {
      const msg =
        e?.response?.data?.message || e?.message || "Registration failed";
      setError(String(msg));
      setResult(null);
    }
  };

  useState(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("status") === "paid") {
      if (sku && serial && ownerName && unlockSecret) {
        registerAsset({
          sku: singleSku || sku,
          serial,
          ownerName,
          unlockSecret,
        })
          .then((d) => {
            setResult(d);
            setError(null);
            setShowSecretModal(Boolean(d?.nextSecret));
            if (d?.svg) {
              const filename =
                d.filename || `sale-${singleSku || sku}-${serial}.svg`;
              const blob = new Blob([d.svg], {
                type: "image/svg+xml;charset=utf-8",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
            }
            addRecentItem({
              sku: singleSku || sku,
              serial,
              itemName: ownerName,
              secret: d.nextSecret,
              kind: "registered",
            });
          })
          .catch((e) => {
            setResult(null);
            const msg =
              e?.response?.data?.message || e?.message || "Registration failed";
            setError(String(msg));
          });
      }
      url.searchParams.delete("status");
      window.history.replaceState({}, "", url.toString());
    }
  });

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {showSecretModal && result?.nextSecret ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur">
          <div className="card w-full max-w-lg p-6">
            <h3 className="mb-3 text-lg font-semibold text-slate-800">
              Save your next secret
            </h3>
            <p className="mb-4 text-sm text-slate-500">
              This secret is shown only once. Store it securely; you'll need it for the next transfer.
            </p>
            <div className="mb-4 flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-autumn-50 px-3 py-2 font-mono text-sm text-autumn-800">
                {result.nextSecret}
              </code>
              <button
                className="btn-outline shrink-0"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(result.nextSecret);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {}
                }}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex justify-end">
              <button className="btn" onClick={() => setShowSecretModal(false)}>
                I've saved my secret key
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="card p-6 space-y-3">
        <h2 className="text-2xl font-semibold text-slate-800">Register Asset</h2>
        <div className="grid grid-cols-3 gap-2 items-end">
          {singleSku ? null : (
            <div className="col-span-1">
              <label className={labelClass}>SKU</label>
              <input
                className="input"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </div>
          )}
          <div className={singleSku ? "col-span-3" : "col-span-2"}>
            <label className={labelClass}>Serial</label>
            <input
              className="input"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>Your Name</label>
          <input
            className="input"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Registration Secret</label>
          <input
            className="input"
            value={unlockSecret}
            onChange={(e) => setUnlockSecret(e.target.value)}
          />
        </div>
        <button
          className="btn"
          disabled={
            !(singleSku || sku) || !serial || !ownerName || !unlockSecret
          }
          onClick={onRegister}>
          Pay $5 & Register
        </button>
        {TESTMODE && (
          <button
            className="btn-outline ml-2"
            type="button"
            onClick={() => {
              const n = Math.random().toString(36).slice(2, 6).toUpperCase();
              setSku("CL1000");
              setSerial(`CL-${n}${Date.now().toString().slice(-4)}`);
              setOwnerName(`Tester ${n}`);
              setUnlockSecret("test-secret-" + n);
            }}>
            Fill Mock Data
          </button>
        )}
      </div>
      <div className="card p-6">
        <h3 className="mb-3 text-lg font-semibold text-slate-800">Result</h3>
        {error ? (
          <div className="text-red-400">{error}</div>
        ) : result ? (
          <div className="space-y-3">
            {result.nextSecret ? (
              <div className="text-slate-600">
                A new secret was generated and shown to you.
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {result.publicUrl ? (
                <a
                  className="btn-outline"
                  href={result.publicUrl}
                  target="_blank"
                  rel="noopener noreferrer">
                  Public Registration
                </a>
              ) : null}
              {result.privateUrl ? (
                <a
                  className="btn-outline"
                  href={result.privateUrl}
                  target="_blank"
                  rel="noopener noreferrer">
                  Private Sale Document
                </a>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-slate-500">Awaiting submission.</p>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { createCheckout, registerAsset } from "../lib/api";
import { addRecentItem } from "../lib/recent";
import { TESTMODE } from "../lib/env";

export default function RegisterAsset() {
  const [sku, setSku] = useState("");
  const [serial, setSerial] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [unlockSecret, setUnlockSecret] = useState("");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

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
        sku,
        serial,
        ownerName,
        unlockSecret,
      });
      setResult(data);
      addRecentItem({
        sku,
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
        registerAsset({ sku, serial, ownerName, unlockSecret })
          .then((d) => {
            setResult(d);
            setError(null);
            addRecentItem({
              sku,
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
      <div className="card p-6 space-y-3">
        <h2 className="text-xl font-semibold">Register Asset</h2>
        <div className="grid grid-cols-3 gap-2 items-end">
          <div className="col-span-1">
            <label className="block text-sm mb-1">SKU</label>
            <input
              className="input"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm mb-1">Serial</label>
            <input
              className="input"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm mb-1">Your Name</label>
          <input
            className="input"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Unlock Secret</label>
          <input
            className="input"
            value={unlockSecret}
            onChange={(e) => setUnlockSecret(e.target.value)}
          />
        </div>
        <button
          className="btn"
          disabled={!sku || !serial || !ownerName || !unlockSecret}
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
        <h3 className="font-semibold mb-2">Result</h3>
        {error ? (
          <div className="text-red-700">{error}</div>
        ) : result ? (
          <div className="space-y-2">
            <div>
              Next Secret:{" "}
              <span className="font-mono">{result.nextSecret}</span>
            </div>
            {result.publicUrl && (
              <a
                className="text-autumn-700 underline"
                href={result.publicUrl}
                target="_blank">
                Public Registration
              </a>
            )}
            {result.privateUrl && (
              <a
                className="text-autumn-700 underline"
                href={result.privateUrl}
                target="_blank">
                Private Sale Document
              </a>
            )}
          </div>
        ) : (
          <p className="text-stone-600">Awaiting submission.</p>
        )}
      </div>
    </div>
  );
}

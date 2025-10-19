import { useState } from "react";
import { createCheckout, createItem, generateSerial } from "../lib/api";
import { addRecentItem } from "../lib/recent";
import { TESTMODE } from "../lib/env";

export default function CreateItem() {
  const [sku, setSku] = useState("");
  const [serial, setSerial] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [ipfsPhotoUri, setIpfsPhotoUri] = useState("");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onGenerate = async () => {
    const g = await generateSerial();
    setSku(g.sku);
    setSerial(g.serial);
  };

  const onFillMock = async () => {
    const n = Math.random().toString(36).slice(2, 8).toUpperCase();
    setItemName(`Mock Item ${n}`);
    setItemDescription(`Autumn-themed mock description ${n}`);
    setPhotoUrl(
      `https://chainletter.mypinata.cloud/ipfs/QmewjNfWbA1avfLhnKfW5ArUwREjKBAkzVnXnd5utSy5XX?img-width=300`
    );
    await onGenerate();
  };

  const onCreate = async () => {
    setLoading(true);
    try {
      const successUrl = window.location.origin + "/create?status=paid";
      const cancelUrl = window.location.href;
      const checkout = await createCheckout(
        "Initial item creation",
        successUrl,
        cancelUrl
      );
      if (checkout.id === "free_mode") {
        const created = await createItem({
          sku,
          serial,
          itemName,
          itemDescription,
          photoUrl: ipfsPhotoUri || photoUrl,
        });
        setResult(created);
        setError(null);
        // Store recent with initialSecret
        addRecentItem({
          sku,
          serial,
          itemName,
          secret: created.initialSecret,
          kind: "created",
        });
      } else {
        window.location.href = checkout.url;
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || "Create failed";
      setError(String(msg));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const onFinalizeIfPaid = async () => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("status") === "paid" && sku && serial && !result) {
      try {
        const created = await createItem({
          sku,
          serial,
          itemName,
          itemDescription,
          photoUrl,
        });
        setResult(created);
        setError(null);
        addRecentItem({
          sku,
          serial,
          itemName,
          secret: created.initialSecret,
          kind: "created",
        });
      } catch (e: any) {
        setResult(null);
        const msg = e?.response?.data?.message || e?.message || "Create failed";
        setError(String(msg));
      }
      url.searchParams.delete("status");
      window.history.replaceState({}, "", url.toString());
    }
  };

  // Try once on mount
  useState(() => {
    onFinalizeIfPaid();
  });

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="card p-6">
        <h2 className="text-xl font-semibold mb-4">Create New Item</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Item Name</label>
            <input
              className="input"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Description</label>
            <textarea
              className="input min-h-[100px]"
              value={itemDescription}
              onChange={(e) => setItemDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Optional Photo URL</label>
            <input
              className="input"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
            />
            <div className="mt-2 flex items-center gap-2">
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setUploadBusy(true);
                  try {
                    const form = new FormData();
                    form.append("image", f);
                    const res = await fetch("/api/upload-image", {
                      method: "POST",
                      body: form,
                    });
                    const json = await res.json();
                    if (json?.data?.url) setPhotoUrl(json.data.url);
                    if (json?.data?.ipfsUri) setIpfsPhotoUri(json.data.ipfsUri);
                  } finally {
                    setUploadBusy(false);
                  }
                }}
              />
              {uploadBusy ? (
                <span className="text-sm text-stone-500">Uploading…</span>
              ) : null}
            </div>
          </div>
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
          <div className="flex items-center gap-2">
            <button onClick={onGenerate} className="btn-outline" type="button">
              Generate New Serial
            </button>
            <button
              onClick={onCreate}
              className="btn"
              disabled={!sku || !serial || loading}
              type="button">
              Pay $5 & Create
            </button>
            {TESTMODE && (
              <button
                onClick={onFillMock}
                className="btn-outline"
                type="button">
                Fill Mock Data
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="card p-6">
        <h3 className="font-semibold mb-2">Result</h3>
        {error ? (
          <div className="text-red-700">{error}</div>
        ) : result ? (
          <div className="space-y-2">
            <div>
              Initial Secret:{" "}
              <span className="font-mono">{result.initialSecret}</span>
            </div>
            {result.certificateUrl && (
              <a
                className="text-autumn-700 underline"
                href={result.certificateUrl}
                target="_blank">
                Public Certificate
              </a>
            )}
            {result.nextSecretUrl && (
              <a
                className="text-autumn-700 underline"
                href={result.nextSecretUrl}
                target="_blank">
                Next Secret SVG
              </a>
            )}
          </div>
        ) : (
          <p className="text-stone-600">No item created yet.</p>
        )}
      </div>
    </div>
  );
}

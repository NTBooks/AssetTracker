import { useState } from "react";
import { createItem, generateSerial } from "../lib/api";
import { addRecentItem } from "../lib/recent";
import { TESTMODE } from "../lib/env";
import { useAuth } from "../lib/auth";
import { useConfig } from "../lib/config";

export default function CreateItem() {
  const {
    loading: authLoading,
    authenticated,
    isAdmin,
    login,
    refresh,
  } = useAuth();
  const { singleSku } = useConfig();
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
  // Bulk create range state
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");
  const [rangeDecimals, setRangeDecimals] = useState<string>("4");
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkDone, setBulkDone] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkSuccess, setBulkSuccess] = useState(0);
  const [bulkFailed, setBulkFailed] = useState(0);
  const [bulkErrors, setBulkErrors] = useState<
    Array<{ serial: string; message: string }>
  >([]);

  const onGenerate = async () => {
    const g = await generateSerial();
    setSku(singleSku || g.sku);
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
      const created = await createItem({
        sku,
        serial,
        itemName,
        itemDescription,
        photoUrl: ipfsPhotoUri || photoUrl,
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
      const msg = e?.response?.data?.message || e?.message || "Create failed";
      setError(String(msg));
      setResult(null);
    } finally {
      setLoading(false);
      // Refresh stamps after operation
      try {
        await refresh();
      } catch {}
    }
  };

  // No payment or finalize steps required for creating items

  const onBulkCreate = async () => {
    const startNum = parseInt(rangeStart || "");
    const endNum = parseInt(rangeEnd || "");
    const pad = Math.max(0, parseInt(rangeDecimals || "0") || 0);
    if (
      !(singleSku || sku) ||
      Number.isNaN(startNum) ||
      Number.isNaN(endNum) ||
      startNum > endNum ||
      !itemName ||
      !itemDescription ||
      !(ipfsPhotoUri || photoUrl)
    )
      return;
    const total = endNum - startNum + 1;
    setBulkRunning(true);
    setBulkDone(0);
    setBulkTotal(total);
    setBulkSuccess(0);
    setBulkFailed(0);
    setBulkErrors([]);
    try {
      for (let n = startNum; n <= endNum; n++) {
        const serialNum = String(n).padStart(pad, "0");
        try {
          await createItem({
            sku: singleSku || sku,
            serial: serialNum,
            itemName,
            itemDescription,
            photoUrl: ipfsPhotoUri || photoUrl,
            stampNowPublic: n === endNum,
            stampNowPrivate: n === endNum,
          });
          setBulkSuccess((s) => s + 1);
        } catch (e: any) {
          const msg =
            e?.response?.data?.message || e?.message || "Create failed";
          setBulkFailed((f) => f + 1);
          setBulkErrors((arr) =>
            [{ serial: serialNum, message: String(msg) }, ...arr].slice(0, 50)
          );
        } finally {
          setBulkDone((d) => d + 1);
        }
      }
    } finally {
      setBulkRunning(false);
      // Refresh stamps after bulk operation
      try {
        await refresh();
      } catch {}
    }
  };

  if (authLoading) {
    return (
      <div className="card p-6">
        <div className="text-stone-600">Checking permissions…</div>
      </div>
    );
  }

  if (!authenticated || !isAdmin) {
    return (
      <div className="card p-6">
        <h2 className="text-xl font-semibold mb-2">Admins only</h2>
        <p className="text-stone-600 mb-4">
          You must be a logged-in admin to create items.
        </p>
        {!authenticated ? (
          <button className="btn" onClick={login} type="button">
            Admin Login
          </button>
        ) : null}
      </div>
    );
  }

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
            {singleSku ? null : (
              <div className="col-span-1">
                <label className="block text-sm mb-1">SKU</label>
                <input
                  className="input"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                />
              </div>
            )}
            <div className={singleSku ? "col-span-3" : "col-span-2"}>
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
              Create
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
          <p className="text-stone-600">No item created yet.</p>
        )}
      </div>

      {/* Bulk Create Panel */}
      <div className="md:col-span-2 card p-6">
        <h2 className="text-xl font-semibold mb-4">Bulk Create Range</h2>
        <p className="text-sm text-stone-600 mb-3">
          Create many items with the same details. Serial numbers will be
          numeric and padded with left zeros.
        </p>
        <div className="grid md:grid-cols-3 gap-3 mb-3">
          {singleSku ? null : (
            <div>
              <label className="block text-sm mb-1">SKU</label>
              <input
                className="input"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </div>
          )}
          <div>
            <label className="block text-sm mb-1">Start</label>
            <input
              className="input"
              type="number"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">End</label>
            <input
              className="input"
              type="number"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
            />
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-3 mb-3">
          <div className="md:col-span-1">
            <label className="block text-sm mb-1">Decimals (pad)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={rangeDecimals}
              onChange={(e) => setRangeDecimals(e.target.value)}
            />
          </div>
          <div className="md:col-span-2 flex items-end">
            <button
              className="btn"
              type="button"
              onClick={onBulkCreate}
              disabled={
                bulkRunning ||
                !(singleSku || sku) ||
                !rangeStart ||
                !rangeEnd ||
                !itemName ||
                !itemDescription ||
                !(ipfsPhotoUri || photoUrl)
              }>
              Start Bulk Create
            </button>
          </div>
        </div>
        {bulkTotal > 0 && (
          <div className="mt-3">
            <div className="h-3 w-full bg-autumn-100 rounded">
              <div
                className="h-3 bg-autumn-600 rounded"
                style={{
                  width: `${Math.round((bulkDone / bulkTotal) * 100)}%`,
                }}
              />
            </div>
            <div className="text-sm text-stone-600 mt-2">
              {bulkDone}/{bulkTotal} • Success {bulkSuccess} • Failed{" "}
              {bulkFailed}
            </div>
            {bulkErrors.length > 0 && (
              <div className="mt-2 text-xs text-red-700 max-h-40 overflow-auto border border-red-200 rounded p-2 bg-red-50">
                {bulkErrors.map((e, i) => (
                  <div key={i}>
                    Serial {e.serial}: {e.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

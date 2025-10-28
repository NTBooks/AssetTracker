import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { contestRegistration, verifyQuery } from "../lib/api";
import { extractSkuSerialFromSvg } from "../util/svgMeta";
import { resolveIpfsCidToHttp, toThumbFromUrlOrCid } from "../lib/ipfs";
import { ClvLink } from "../lib/clv";
import { useConfig } from "../lib/config";

export default function Verify() {
  const location = useLocation();
  const { singleSku } = useConfig();
  const [sku, setSku] = useState("");
  const [serial, setSerial] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const onSearch = async () => {
    setLoading(true);
    try {
      setData(await verifyQuery(singleSku || sku, serial));
    } finally {
      setLoading(false);
    }
  };

  // Populate fields and auto-search on initial load and whenever the query changes
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const skuQ = singleSku || params.get("sku") || "";
    const serialQ = params.get("serial") || "";
    if (skuQ) setSku(skuQ);
    if (serialQ) setSerial(serialQ);
    if (skuQ && serialQ) {
      verifyQuery(singleSku || skuQ, serialQ)
        .then(setData)
        .catch(() => {});
    }
  }, [location.search, singleSku]);

  const onContest = async (registrationId: number) => {
    const secret = window.prompt("Enter unlock secret for this registration");
    if (!secret) return;
    const reason =
      window.prompt("Reason (lost, stolen, fraud, other)", "other") || "other";
    await contestRegistration(registrationId, secret, reason);
    await onSearch();
  };

  const chainCount = data?.registrations?.length ?? 0;
  const contestedCount = (data?.registrations ?? []).filter(
    (r: any) => r.contested
  ).length;

  return (
    <div className="space-y-4">
      {(data?.serial?.public_cid || data?.serial?.photo_url) && (
        <div className="grid md:grid-cols-2 gap-4">
          {data?.serial?.public_cid ? (
            <div className="card p-4">
              <h3 className="font-semibold mb-2">Original Certificate</h3>
              <ClvLink
                cid={data.serial.public_cid}
                className="inline-block"
                href={resolveIpfsCidToHttp(data.serial.public_cid) || "#"}
                target="_blank"
                rel="noopener noreferrer">
                <img
                  src={toThumbFromUrlOrCid(data.serial.public_cid, 300) || ""}
                  alt="Original certificate"
                  className="max-h-64 rounded border"
                />
              </ClvLink>
            </div>
          ) : null}
          {data?.serial?.photo_url ? (
            <div className="card p-4">
              <h3 className="font-semibold mb-2">Item</h3>
              <div className="flex gap-4 items-start">
                <a
                  className="inline-block"
                  href={data.serial.photo_url}
                  target="_blank"
                  rel="noopener noreferrer">
                  <img
                    src={toThumbFromUrlOrCid(data.serial.photo_url, 300) || ""}
                    alt="Item thumbnail"
                    className="max-h-40 rounded border"
                  />
                </a>
                <div className="flex-1 min-w-0">
                  {data.serial.item_name ? (
                    <div className="font-semibold mb-1 break-words">
                      {data.serial.item_name}
                    </div>
                  ) : null}
                  {data.serial.item_description ? (
                    <div className="text-sm text-stone-700 whitespace-pre-wrap break-words">
                      {data.serial.item_description}
                    </div>
                  ) : (
                    <div className="text-sm text-stone-500">No description</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
      <div className="card p-4 flex gap-2 items-end">
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
          <label className="block text-sm mb-1">Serial</label>
          <input
            className="input"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
          />
        </div>
        <button className="btn" onClick={onSearch}>
          Search
        </button>
        <div className="ml-auto">
          <label className="block text-sm mb-1">
            Or Upload Registration SVG
          </label>
          <input
            type="file"
            accept="image/svg+xml"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              const meta = extractSkuSerialFromSvg(text);
              if (meta) {
                setSku(singleSku || meta.sku);
                setSerial(meta.serial);
              }
            }}
          />
        </div>
      </div>

      {loading && <div className="p-4">Loading...</div>}
      {data && (
        <div className="space-y-4">
          <div
            className={`card p-4 ${
              contestedCount ? "border-red-300" : "border-green-300"
            }`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-stone-600">Status</div>
                <div className="font-semibold">
                  {chainCount} link(s) •{" "}
                  {contestedCount
                    ? `${contestedCount} contested`
                    : "no contests"}
                </div>
              </div>
              <a
                className="btn-outline"
                href={`/register?${
                  singleSku ? "" : `sku=${encodeURIComponent(sku)}&`
                }serial=${encodeURIComponent(serial)}`}>
                Register Asset
              </a>
            </div>
          </div>

          <div className="card p-4">
            <h3 className="font-semibold mb-2">Registrations</h3>
            <ul className="divide-y">
              {(data.registrations ?? []).map((r: any) => (
                <li
                  key={r.id}
                  className="py-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{r.owner_name}</div>
                    <div className="text-sm text-stone-500">
                      {new Date(r.created_at).toLocaleString()}
                    </div>
                    {r.public_file_url && (
                      <a
                        className="text-autumn-700 underline"
                        href={r.public_file_url}
                        target="_blank">
                        Public file
                      </a>
                    )}
                    {r.contested ? (
                      <span className="ml-2 text-red-600">Contested</span>
                    ) : null}
                  </div>
                  <button
                    className="btn-outline"
                    onClick={() => onContest(r.id)}>
                    Contest
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

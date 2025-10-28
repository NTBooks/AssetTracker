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
  const [thumbOrientation, setThumbOrientation] = useState<
    "landscape" | "portrait" | "square" | null
  >(null);
  const [thumbReady, setThumbReady] = useState(false);

  const onSearch = async () => {
    setLoading(true);
    setData(null);
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
      setLoading(true);
      setData(null);
      verifyQuery(singleSku || skuQ, serialQ)
        .then(setData)
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [location.search, singleSku]);

  // Determine thumbnail orientation to pick a responsive layout
  useEffect(() => {
    const url = toThumbFromUrlOrCid(data?.serial?.photo_url, 600);
    if (!url) {
      setThumbOrientation(null);
      setThumbReady(false);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      if (!w || !h) {
        setThumbOrientation(null);
        setThumbReady(false);
        return;
      }
      if (w > h * 1.1) setThumbOrientation("landscape");
      else if (h > w * 1.1) setThumbOrientation("portrait");
      else setThumbOrientation("square");
      setThumbReady(true);
    };
    img.onerror = () => setThumbOrientation(null);
    img.src = url;
  }, [data?.serial?.photo_url]);

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
      </div>
      {loading ? (
        <div className="grid md:grid-cols-2 gap-4">
          <SkeletonPanel title="Original Certificate" withImage />
          <SkeletonPanel title="Item" withImage lines={3} />
        </div>
      ) : (
        (data?.serial?.public_cid || data?.serial?.photo_url) && (
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
                  <FadeImg
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
                {!thumbReady ? (
                  <div>
                    <div className="w-full h-40 bg-stone-200 rounded mb-3 animate-pulse" />
                    <div className="space-y-2 animate-pulse">
                      <div className="h-3 bg-stone-200 rounded w-2/3" />
                      <div className="h-3 bg-stone-200 rounded w-3/5" />
                      <div className="h-3 bg-stone-200 rounded w-1/3" />
                    </div>
                  </div>
                ) : thumbOrientation === "landscape" ? (
                  <div>
                    <a
                      className="block mb-3"
                      href={data.serial.photo_url}
                      target="_blank"
                      rel="noopener noreferrer">
                      <FadeImg
                        src={
                          toThumbFromUrlOrCid(data.serial.photo_url, 600) || ""
                        }
                        alt="Item thumbnail"
                        className="w-full h-48 object-cover rounded border"
                      />
                    </a>
                    <ItemMeta
                      name={data.serial.item_name}
                      description={data.serial.item_description}
                    />
                  </div>
                ) : (
                  <div className="flex gap-4 items-start">
                    <a
                      className="inline-block"
                      href={data.serial.photo_url}
                      target="_blank"
                      rel="noopener noreferrer">
                      <FadeImg
                        src={
                          toThumbFromUrlOrCid(data.serial.photo_url, 300) || ""
                        }
                        alt="Item thumbnail"
                        className="w-40 h-40 object-cover rounded border"
                      />
                    </a>
                    <ItemMeta
                      name={data.serial.item_name}
                      description={data.serial.item_description}
                    />
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )
      )}
      {loading ? (
        <>
          <SkeletonPanel title="Status" lines={2} />
          <SkeletonList title="Registrations" items={3} />
        </>
      ) : (
        data && (
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
        )
      )}
    </div>
  );
}

function ItemMeta({
  name,
  description,
}: {
  name?: string | null;
  description?: string | null;
}) {
  return (
    <div className="flex-1 min-w-0">
      {name ? (
        <div className="font-semibold mb-1 break-words">{name}</div>
      ) : null}
      {description ? (
        <div className="text-sm text-stone-700 whitespace-pre-wrap break-words">
          {description}
        </div>
      ) : (
        <div className="text-sm text-stone-500">No description</div>
      )}
    </div>
  );
}

function SkeletonPanel({
  title,
  withImage = false,
  lines = 2,
}: {
  title: string;
  withImage?: boolean;
  lines?: number;
}) {
  return (
    <div className="card p-4 animate-pulse">
      <h3 className="font-semibold mb-2">{title}</h3>
      {withImage ? (
        <div className="w-full h-40 bg-stone-200 rounded mb-3" />
      ) : null}
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-3 bg-stone-200 rounded" />
        ))}
      </div>
    </div>
  );
}

function SkeletonList({ title, items = 3 }: { title: string; items?: number }) {
  return (
    <div className="card p-4 animate-pulse">
      <h3 className="font-semibold mb-2">{title}</h3>
      <div className="space-y-3">
        {Array.from({ length: items }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="space-y-2 w-2/3">
              <div className="h-3 bg-stone-200 rounded w-2/3" />
              <div className="h-3 bg-stone-200 rounded w-1/3" />
            </div>
            <div className="h-8 w-20 bg-stone-200 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function FadeImg({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={src}
      alt={alt}
      onLoad={() => setLoaded(true)}
      className={`${className || ""} transition-opacity duration-300 ${
        loaded ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

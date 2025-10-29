import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  contestRegistration,
  verifyQuery,
  createProof,
  createCheckout,
  createTransfer,
  revokeTransfer,
} from "../lib/api";
import { extractSkuSerialFromSvg } from "../util/svgMeta";
import {
  resolveIpfsCidToHttp,
  toThumbFromUrlOrCid,
  extractCidFromUrlOrString,
} from "../lib/ipfs";
import { ClvLink, ClvTag } from "../lib/clv";
import { useConfig } from "../lib/config";
import { formatLocalDateTime } from "../lib/datetime";
import { addRecentItem } from "../lib/recent";

export default function Verify() {
  const location = useLocation();
  const { singleSku, contestReasons } = useConfig();
  const [sku, setSku] = useState("");
  const [serial, setSerial] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [thumbOrientation, setThumbOrientation] = useState<
    "landscape" | "portrait" | "square" | null
  >(null);
  const [thumbReady, setThumbReady] = useState(false);
  const [certReady, setCertReady] = useState(false);
  const [contestModal, setContestModal] = useState<{
    open: boolean;
    registrationId?: number;
    secret: string;
    reason: string;
    error?: string;
    loading: boolean;
  }>({ open: false, secret: "", reason: "other", loading: false });
  const [proofModal, setProofModal] = useState<{
    open: boolean;
    registrationId?: number;
    secret: string;
    phrase: string;
    error?: string;
    loading: boolean;
  }>({ open: false, secret: "", phrase: "", loading: false });
  const [transferModal, setTransferModal] = useState<{
    open: boolean;
    secret: string;
    ownerName: string;
    loading: boolean;
    error?: string;
  }>({ open: false, secret: "", ownerName: "", loading: false });
  const [revokeModal, setRevokeModal] = useState<{
    open: boolean;
    secret: string;
    loading: boolean;
    error?: string;
  }>({ open: false, secret: "", loading: false });

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
    // Finalize proof after checkout redirect
    const proof = params.get("proof");
    const reg = Number(params.get("reg"));
    if (params.get("status") === "paid" && proof === "1" && reg) {
      finalizeProof(reg);
      params.delete("status");
      params.delete("proof");
      params.delete("reg");
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, "", newUrl);
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

  // Preload certificate thumbnail to drive skeleton state
  useEffect(() => {
    const url = toThumbFromUrlOrCid(data?.serial?.public_cid, 300);
    if (!url) {
      setCertReady(false);
      return;
    }
    setCertReady(false);
    const img = new Image();
    img.onload = () => setCertReady(true);
    img.onerror = () => setCertReady(false);
    img.src = url;
  }, [data?.serial?.public_cid]);

  const onContest = async (registrationId: number) => {
    setContestModal({
      open: true,
      registrationId,
      secret: "",
      reason: (contestReasons && contestReasons[0]) || "other",
      loading: false,
      error: undefined,
    });
  };

  const onCreateProof = async (registrationId: number) => {
    setProofModal({
      open: true,
      registrationId,
      secret: "",
      phrase: "",
      loading: false,
      error: undefined,
    });
  };

  const onOpenTransfer = () => {
    setTransferModal({
      open: true,
      secret: "",
      ownerName: "",
      loading: false,
      error: undefined,
    });
  };
  const onOpenRevoke = () => {
    setRevokeModal({
      open: true,
      secret: "",
      loading: false,
      error: undefined,
    });
  };

  const finalizeProof = async (registrationId: number) => {
    try {
      const stored = sessionStorage.getItem(`proof.${registrationId}`);
      let secret = "";
      let phrase = "";
      if (stored) {
        const obj = JSON.parse(stored);
        secret = obj?.secret || "";
        phrase = obj?.phrase || "";
      }
      if (!secret) {
        const s = window.prompt("Re-enter registration secret");
        if (!s) return;
        secret = s;
      }
      if (!phrase) {
        const p = window.prompt("Re-enter proof phrase", "");
        phrase = p || "";
      }
      const resp = await createProof({
        registrationId,
        sku: singleSku || sku,
        serial,
        phrase,
        secret,
      });
      try {
        sessionStorage.removeItem(`proof.${registrationId}`);
      } catch {}
      try {
        addRecentItem({
          sku: singleSku || sku,
          serial,
          kind: "proof",
          proofCid: resp.cid,
        });
      } catch {}
      // download text file named with CID
      const blob = new Blob([resp.text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${resp.cid}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      // open proof page with clverify tag
      window.open(`/proof?cid=${encodeURIComponent(resp.cid)}`, "_blank");
    } catch (e) {
      throw e;
    }
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
      {/* Contested/Clean banner */}
      {data
        ? (() => {
            const contestedRegs = (data.registrations || []).filter((r: any) =>
              Number(r.contested)
            );
            if (contestedRegs.length > 0) {
              return (
                <div className="card card-danger p-4">
                  <div className="text-white font-semibold mb-2">
                    Contested Registrations ({contestedRegs.length})
                  </div>
                  <ul className="space-y-2 text-sm text-white/95">
                    {contestedRegs.map((r: any) => (
                      <li key={r.id}>
                        <span className="font-medium">
                          {r.owner_name || "Unknown"}
                        </span>{" "}
                        on {formatLocalDateTime(r.created_at)}
                        {r.contest_reason ? (
                          <>
                            {" "}
                            — reason:{" "}
                            <span className="font-medium">
                              {r.contest_reason}
                            </span>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            }
            return (
              <div className="card p-4 border-green-300 bg-green-50/80">
                <div className="text-green-800 font-semibold mb-1">
                  Clean History
                </div>
                <div className="text-sm text-green-900">
                  No contested registrations found for this item.
                </div>
              </div>
            );
          })()
        : null}
      {loading ? (
        <div className="grid md:grid-cols-2 gap-4">
          <SkeletonPanel title="Item" withImage lines={3} />
          <SkeletonPanel title="Original Certificate" withImage />
        </div>
      ) : (
        (data?.serial?.public_cid || data?.serial?.photo_url) && (
          <div className="grid md:grid-cols-2 gap-4">
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
            {data?.serial?.public_cid ? (
              certReady ? (
                <div className="card p-4">
                  <h3 className="font-semibold mb-2">Original Certificate</h3>
                  <ClvLink
                    cid={data.serial.public_cid}
                    className="inline-block"
                    href={resolveIpfsCidToHttp(data.serial.public_cid) || "#"}
                    target="_blank"
                    rel="noopener noreferrer">
                    <img
                      src={
                        toThumbFromUrlOrCid(data.serial.public_cid, 300) || ""
                      }
                      alt="Original certificate"
                      className="max-h-64 rounded border"
                    />
                  </ClvLink>
                </div>
              ) : (
                <SkeletonPanel title="Original Certificate" withImage />
              )
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
                    {chainCount}{" "}
                    {chainCount === 1 ? "registration" : "registrations"} •{" "}
                    {contestedCount
                      ? `${contestedCount} ${
                          contestedCount === 1 ? "issue" : "issues"
                        }`
                      : "no issues"}
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

            {(data.registrations ?? []).length > 0 ? (
              <div className="card p-4">
                <h3 className="font-semibold mb-2">Registrations</h3>
                <p className="text-sm text-stone-600 mb-3">
                  Note: You can only create proofs or report issues for
                  registrations you control, and you will need the original
                  registration secret to make changes.
                </p>
                <ul className="divide-y">
                  {(data.registrations ?? []).map((r: any, idx: number) => (
                    <li
                      key={r.id}
                      className="py-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium">{r.owner_name}</div>
                        <div className="text-sm text-stone-500">
                          {formatLocalDateTime(r.created_at)}
                        </div>
                        {r.public_file_url && (
                          <div className="flex items-center gap-2">
                            <a
                              className="text-autumn-700 underline"
                              href={r.public_file_url}
                              target="_blank">
                              Public file
                            </a>
                            {extractCidFromUrlOrString(r.public_file_url) ? (
                              <ClvTag
                                cid={
                                  extractCidFromUrlOrString(r.public_file_url)!
                                }
                              />
                            ) : null}
                          </div>
                        )}
                        {r.contested ? (
                          <span className="ml-2 text-red-600">Contested</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="btn-danger"
                          onClick={() => onContest(r.id)}>
                          Report
                        </button>
                        <button
                          className="btn"
                          onClick={() => onCreateProof(r.id)}>
                          Create proof
                        </button>
                        {idx === (data.registrations?.length || 0) - 1 ? (
                          data.serial?.pending_unlock_id ? (
                            <button
                              className="btn-danger"
                              onClick={onOpenRevoke}>
                              Revoke
                            </button>
                          ) : (
                            <button
                              className="btn-outline"
                              onClick={onOpenTransfer}>
                              Transfer
                            </button>
                          )
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )
      )}
      {/* Contest Modal */}
      {contestModal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
            <h3 className="text-lg font-semibold mb-2">Contest Registration</h3>
            {contestModal.error ? (
              <div className="mb-3 text-red-700">{contestModal.error}</div>
            ) : null}
            <label className="block text-sm mb-1">Registration Secret</label>
            <input
              className="input mb-3"
              value={contestModal.secret}
              onChange={(e) =>
                setContestModal((m) => ({ ...m, secret: e.target.value }))
              }
            />
            <label className="block text-sm mb-1">Reason</label>
            <select
              className="input mb-4"
              value={contestModal.reason}
              onChange={(e) =>
                setContestModal((m) => ({ ...m, reason: e.target.value }))
              }>
              {(contestReasons && contestReasons.length > 0
                ? contestReasons
                : ["lost", "stolen", "fraud", "other"]
              ).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                className="btn-outline"
                onClick={() => setContestModal((m) => ({ ...m, open: false }))}>
                Cancel
              </button>
              <button
                className="btn"
                disabled={!contestModal.secret || contestModal.loading}
                onClick={async () => {
                  if (!contestModal.registrationId) return;
                  setContestModal((m) => ({
                    ...m,
                    loading: true,
                    error: undefined,
                  }));
                  try {
                    await contestRegistration(
                      contestModal.registrationId,
                      contestModal.secret,
                      contestModal.reason || "other"
                    );
                    setContestModal({
                      open: false,
                      secret: "",
                      reason: "other",
                      loading: false,
                    });
                    await onSearch();
                  } catch (e: any) {
                    const msg = e?.response?.data?.message || "Contest failed";
                    setContestModal((m) => ({
                      ...m,
                      loading: false,
                      error: String(msg),
                    }));
                  }
                }}>
                Submit
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Create Proof Modal */}
      {proofModal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
            <h3 className="text-lg font-semibold mb-2">Create Proof</h3>
            {proofModal.error ? (
              <div className="mb-3 text-red-700">{proofModal.error}</div>
            ) : null}
            <label className="block text-sm mb-1">Registration Secret</label>
            <input
              className="input mb-3"
              value={proofModal.secret}
              onChange={(e) =>
                setProofModal((m) => ({ ...m, secret: e.target.value }))
              }
            />
            <label className="block text-sm mb-1">Proof Phrase</label>
            <input
              className="input mb-4"
              value={proofModal.phrase}
              onChange={(e) =>
                setProofModal((m) => ({ ...m, phrase: e.target.value }))
              }
            />
            <div className="flex justify-end gap-2">
              <button
                className="btn-outline"
                onClick={() => setProofModal((m) => ({ ...m, open: false }))}>
                Cancel
              </button>
              <button
                className="btn"
                disabled={!proofModal.secret || proofModal.loading}
                onClick={async () => {
                  if (!proofModal.registrationId) return;
                  setProofModal((m) => ({
                    ...m,
                    loading: true,
                    error: undefined,
                  }));
                  try {
                    const a = (proofModal.secret || "").trim();
                    const b = (proofModal.phrase || "").trim();
                    if (a && b && a === b) {
                      setProofModal((m) => ({
                        ...m,
                        loading: false,
                        error:
                          "Phrase must be different from your registration secret",
                      }));
                      return;
                    }
                    sessionStorage.setItem(
                      `proof.${proofModal.registrationId}`,
                      JSON.stringify({
                        secret: proofModal.secret,
                        phrase: proofModal.phrase,
                      })
                    );
                    const successUrl = `${
                      window.location.origin
                    }/verify?sku=${encodeURIComponent(
                      singleSku || sku
                    )}&serial=${encodeURIComponent(
                      serial
                    )}&status=paid&proof=1&reg=${proofModal.registrationId}`;
                    const cancelUrl = window.location.href;
                    const checkout = await createCheckout(
                      `Proof for ${singleSku || sku}/${serial}`,
                      successUrl,
                      cancelUrl
                    );
                    if (checkout.id !== "free_mode") {
                      setProofModal((m) => ({ ...m, open: false }));
                      window.location.href = checkout.url;
                      return;
                    }
                    await finalizeProof(proofModal.registrationId);
                    setProofModal((m) => ({ ...m, open: false }));
                  } catch (e: any) {
                    const msg = e?.response?.data?.message || "Proof failed";
                    setProofModal((m) => ({
                      ...m,
                      loading: false,
                      error: String(msg),
                    }));
                  }
                }}>
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Transfer Modal */}
      {transferModal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
            <h3 className="text-lg font-semibold mb-2">
              Create Transfer Document
            </h3>
            {transferModal.error ? (
              <div className="mb-3 text-red-700">{transferModal.error}</div>
            ) : null}
            <label className="block text-sm mb-1">Registration Secret</label>
            <input
              className="input mb-3"
              value={transferModal.secret}
              onChange={(e) =>
                setTransferModal((m) => ({ ...m, secret: e.target.value }))
              }
            />
            <label className="block text-sm mb-1">Your Name (optional)</label>
            <input
              className="input mb-4"
              value={transferModal.ownerName}
              onChange={(e) =>
                setTransferModal((m) => ({ ...m, ownerName: e.target.value }))
              }
            />
            <div className="flex justify-end gap-2">
              <button
                className="btn-outline"
                onClick={() =>
                  setTransferModal((m) => ({ ...m, open: false }))
                }>
                Cancel
              </button>
              <button
                className="btn"
                disabled={!transferModal.secret || transferModal.loading}
                onClick={async () => {
                  setTransferModal((m) => ({
                    ...m,
                    loading: true,
                    error: undefined,
                  }));
                  try {
                    const resp = await createTransfer({
                      sku: singleSku || sku,
                      serial,
                      secret: transferModal.secret,
                      ownerName: transferModal.ownerName,
                    });
                    // download SVG directly (private URL is admin-only)
                    if (resp?.svg) {
                      const filename =
                        resp.filename ||
                        `sale-${singleSku || sku}-${serial}.svg`;
                      const blob = new Blob([resp.svg], {
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
                    setTransferModal((m) => ({
                      ...m,
                      open: false,
                      loading: false,
                    }));
                    await onSearch();
                  } catch (e: any) {
                    const msg = e?.response?.data?.message || "Transfer failed";
                    setTransferModal((m) => ({
                      ...m,
                      loading: false,
                      error: String(msg),
                    }));
                  }
                }}>
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Revoke Modal */}
      {revokeModal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
            <h3 className="text-lg font-semibold mb-2">Revoke Transfer</h3>
            {revokeModal.error ? (
              <div className="mb-3 text-red-700">{revokeModal.error}</div>
            ) : null}
            <label className="block text-sm mb-1">Registration Secret</label>
            <input
              className="input mb-4"
              value={revokeModal.secret}
              onChange={(e) =>
                setRevokeModal((m) => ({ ...m, secret: e.target.value }))
              }
            />
            <div className="flex justify-end gap-2">
              <button
                className="btn-outline"
                onClick={() => setRevokeModal((m) => ({ ...m, open: false }))}>
                Cancel
              </button>
              <button
                className="btn-danger"
                disabled={!revokeModal.secret || revokeModal.loading}
                onClick={async () => {
                  setRevokeModal((m) => ({
                    ...m,
                    loading: true,
                    error: undefined,
                  }));
                  try {
                    await revokeTransfer({
                      sku: singleSku || sku,
                      serial,
                      secret: revokeModal.secret,
                    });
                    setRevokeModal((m) => ({
                      ...m,
                      open: false,
                      loading: false,
                    }));
                    await onSearch();
                  } catch (e: any) {
                    const msg = e?.response?.data?.message || "Revoke failed";
                    setRevokeModal((m) => ({
                      ...m,
                      loading: false,
                      error: String(msg),
                    }));
                  }
                }}>
                Revoke
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
    <div className="card p-4">
      <h3 className="font-semibold mb-2">{title}</h3>
      <div className="animate-pulse">
        {withImage ? (
          <div className="w-full h-40 bg-stone-200 rounded mb-3" />
        ) : null}
        <div className="space-y-2">
          {Array.from({ length: lines }).map((_, i) => (
            <div key={i} className="h-3 bg-stone-200 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}

function SkeletonList({ title, items = 3 }: { title: string; items?: number }) {
  return (
    <div className="card p-4">
      <h3 className="font-semibold mb-2">{title}</h3>
      <div className="space-y-3 animate-pulse">
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

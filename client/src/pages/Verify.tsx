import { useEffect, useState, useRef } from "react";
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
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";

export default function Verify() {
  const location = useLocation();
  const { singleSku, contestReasons, ipfsGateway } = useConfig();
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
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const menuRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  const labelClass =
    "block text-xs font-semibold tracking-[0.08em] uppercase text-slate-600 mb-2";

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
    const url = toThumbFromUrlOrCid(data?.serial?.photo_url, 600, ipfsGateway);
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
    img.onerror = () => {
      setThumbOrientation(null);
      setThumbReady(true);
    };
    img.src = url;
  }, [data?.serial?.photo_url, ipfsGateway]);

  // Preload certificate thumbnail to drive skeleton state
  useEffect(() => {
    const url = toThumbFromUrlOrCid(data?.serial?.public_cid, 300, ipfsGateway);
    if (!url) {
      setCertReady(false);
      return;
    }
    setCertReady(false);
    const img = new Image();
    img.onload = () => setCertReady(true);
    img.onerror = () => setCertReady(false);
    img.src = url;
  }, [data?.serial?.public_cid, ipfsGateway]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openMenuId !== null) {
        const menuElement = menuRefs.current[openMenuId];
        if (menuElement && !menuElement.contains(event.target as Node)) {
          setOpenMenuId(null);
        }
      }
    };

    if (openMenuId !== null) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [openMenuId]);

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
      <div className="card flex flex-wrap items-end gap-4 p-4">
        {singleSku ? null : (
          <div>
            <label className={labelClass}>SKU</label>
            <input
              className="input"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
            />
          </div>
        )}
        <div>
          <label className={labelClass}>Serial</label>
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
      {/* Contested/Clean banner - only show if serial exists */}
      {data && data.serial
        ? (() => {
            const contestedRegs = (data.registrations || []).filter((r: any) =>
              Number(r.contested)
            );
            if (contestedRegs.length > 0) {
              return (
                <div className="card card-danger p-4">
                  <div className="font-semibold mb-2">
                    Contested Registrations ({contestedRegs.length})
                  </div>
                  <ul className="space-y-2 text-sm">
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
              <div className="card border border-autumn-500/40 bg-autumn-50 p-4">
                <div className="mb-1 font-semibold text-autumn-700">
                  Clean History
                </div>
                <div className="text-sm text-autumn-700/80">
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
      ) : data && !data.serial ? (
        // Serial not found - show nice not found panel
        <div className="card p-8">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="mb-4 text-6xl">🔍</div>
            <h3 className="mb-2 text-2xl font-semibold text-slate-800">
              Serial Number Not Found
            </h3>
            <p className="text-slate-600">
              The serial number{" "}
              <span className="font-mono font-semibold">{serial}</span>{" "}
              {singleSku ? "" : `for SKU ${sku} `}
              could not be found in our records.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Please check the serial number and try again.
            </p>
          </div>
        </div>
      ) : (
        (data?.serial?.public_cid || data?.serial?.photo_url) && (
          <div className="grid md:grid-cols-2 gap-4">
            {data?.serial?.photo_url ? (
              <div className="card p-4">
                <h3 className="mb-2 text-lg font-semibold text-slate-800">
                  Item
                </h3>
                {!thumbReady ? (
                  <div>
                    <div className="mb-3 h-40 w-full animate-pulse rounded bg-slate-200" />
                    <div className="space-y-2 animate-pulse">
                      <div className="h-3 w-2/3 rounded bg-slate-200" />
                      <div className="h-3 w-3/5 rounded bg-slate-200" />
                      <div className="h-3 w-1/3 rounded bg-slate-200" />
                    </div>
                    <ItemMeta
                      name={data?.serial?.item_name}
                      description={data?.serial?.item_description}
                    />
                  </div>
                ) : thumbOrientation === "landscape" ? (
                  <div>
                    <a
                      className="block mb-3"
                      href={data.serial.photo_url}
                      target="_blank"
                      rel="noopener noreferrer">
                      <UrlOrCidThumb
                        urlOrCid={data.serial.photo_url}
                        size={600}
                        alt="Item thumbnail"
                        className="h-48 w-full rounded border border-slate-200 object-cover"
                        ipfsGateway={ipfsGateway}
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
                      <UrlOrCidThumb
                        urlOrCid={data.serial.photo_url}
                        size={300}
                        alt="Item thumbnail"
                        className="h-40 w-40 rounded border border-slate-200 object-cover"
                        ipfsGateway={ipfsGateway}
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
              <div className="card p-4">
                <h3 className="mb-2 text-lg font-semibold text-slate-800">
                  Original Certificate
                </h3>
                <ClvLink
                  cid={data.serial.public_cid}
                  className="inline-block"
                  href={
                    resolveIpfsCidToHttp(data.serial.public_cid, ipfsGateway) ||
                    "#"
                  }
                  target="_blank"
                  rel="noopener noreferrer">
                  <CidThumb
                    cid={data.serial.public_cid}
                    size={300}
                    className="max-h-64 rounded border border-slate-200"
                    ipfsGateway={ipfsGateway}
                  />
                </ClvLink>
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
        data &&
        data.serial && (
          <div className="space-y-4">
            <div
              className={`card p-4 ${
                contestedCount
                  ? "border border-red-500/40"
                  : "border border-autumn-500/30"
              }`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-500">Status</div>
                  <div className="font-semibold text-slate-800">
                    {`${chainCount} ${
                      chainCount === 1 ? "registration" : "registrations"
                    } • ${
                      contestedCount
                        ? `${contestedCount} ${
                            contestedCount === 1 ? "issue" : "issues"
                          }`
                        : "no issues"
                    }`}
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
                <h3 className="mb-2 text-lg font-semibold text-slate-800">
                  Registrations
                </h3>
                <p className="mb-3 text-sm text-slate-500">
                  Note: You can only create proofs or report issues for
                  registrations you control, and you will need the original
                  registration secret to make changes.
                </p>
                <ul className="divide-y divide-slate-200">
                  {(data.registrations ?? []).map((r: any, idx: number) => {
                    const isLastRegistration =
                      idx === (data.registrations?.length || 0) - 1;
                    const isMenuOpen = openMenuId === r.id;

                    return (
                      <li
                        key={r.id}
                        className="flex flex-col md:flex-row md:items-center md:justify-between py-3 gap-3 md:gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{r.owner_name}</div>
                          <div className="text-sm text-slate-500">
                            {formatLocalDateTime(r.created_at)}
                          </div>
                          {r.contested ? (
                            <span className="ml-2 text-sm text-red-500">
                              Contested
                            </span>
                          ) : null}
                        </div>

                        {/* ClvTag and Menu toggle */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {r.public_file_url &&
                            extractCidFromUrlOrString(r.public_file_url) && (
                              <ClvTag
                                cid={
                                  extractCidFromUrlOrString(r.public_file_url)!
                                }
                              />
                            )}
                          <div
                            className="relative inline-block"
                            ref={(el: HTMLDivElement | null) =>
                              (menuRefs.current[r.id] = el)
                            }>
                            <button
                              className="p-2 rounded-lg border border-slate-300 hover:bg-slate-50 transition-colors"
                              onClick={() =>
                                setOpenMenuId(isMenuOpen ? null : r.id)
                              }
                              aria-label="Actions menu">
                              <EllipsisVerticalIcon className="h-5 w-5 text-slate-600" />
                            </button>
                            {isMenuOpen && (
                              <div className="absolute right-0 top-full mt-1 w-48 md:w-56 bg-white rounded-lg border border-slate-200 shadow-lg z-10 py-1">
                                {r.public_file_url && (
                                  <a
                                    href={r.public_file_url}
                                    target="_blank"
                                    className="block w-full text-left px-4 py-2 md:py-2.5 text-sm md:font-medium text-autumn-700 hover:bg-autumn-50 transition-colors"
                                    onClick={() => setOpenMenuId(null)}>
                                    Public file
                                  </a>
                                )}
                                <button
                                  className="w-full text-left px-4 py-2 md:py-2.5 text-sm md:font-medium text-red-600 hover:bg-red-50 transition-colors"
                                  onClick={() => {
                                    onContest(r.id);
                                    setOpenMenuId(null);
                                  }}>
                                  Report
                                </button>
                                <button
                                  className="w-full text-left px-4 py-2 md:py-2.5 text-sm md:font-medium text-autumn-700 hover:bg-autumn-50 transition-colors"
                                  onClick={() => {
                                    onCreateProof(r.id);
                                    setOpenMenuId(null);
                                  }}>
                                  Create proof
                                </button>
                                {isLastRegistration ? (
                                  data.serial?.pending_unlock_id ? (
                                    <button
                                      className="w-full text-left px-4 py-2 md:py-2.5 text-sm md:font-medium text-red-600 hover:bg-red-50 transition-colors"
                                      onClick={() => {
                                        onOpenRevoke();
                                        setOpenMenuId(null);
                                      }}>
                                      Revoke
                                    </button>
                                  ) : (
                                    <button
                                      className="w-full text-left px-4 py-2 md:py-2.5 text-sm md:font-medium text-autumn-700 hover:bg-autumn-50 transition-colors"
                                      onClick={() => {
                                        onOpenTransfer();
                                        setOpenMenuId(null);
                                      }}>
                                      Transfer
                                    </button>
                                  )
                                ) : null}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        )
      )}
      {/* Contest Modal */}
      {contestModal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur">
          <div className="card w-full max-w-lg p-6">
            <h3 className="mb-3 text-lg font-semibold text-slate-800">
              Contest Registration
            </h3>
            {contestModal.error ? (
              <div className="mb-3 text-sm text-red-500">
                {contestModal.error}
              </div>
            ) : null}
            <label className={labelClass}>Registration Secret</label>
            <input
              className="input mb-4"
              value={contestModal.secret}
              onChange={(e) =>
                setContestModal((m) => ({ ...m, secret: e.target.value }))
              }
            />
            <label className={labelClass}>Reason</label>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur">
          <div className="card w-full max-w-lg p-6">
            <h3 className="mb-3 text-lg font-semibold text-slate-800">
              Create Proof
            </h3>
            {proofModal.error ? (
              <div className="mb-3 text-sm text-red-500">
                {proofModal.error}
              </div>
            ) : null}
            <label className={labelClass}>Registration Secret</label>
            <input
              className="input mb-4"
              value={proofModal.secret}
              onChange={(e) =>
                setProofModal((m) => ({ ...m, secret: e.target.value }))
              }
            />
            <label className={labelClass}>Proof Phrase</label>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur">
          <div className="card w-full max-w-lg p-6">
            <h3 className="mb-3 text-lg font-semibold text-slate-800">
              Create Transfer Document
            </h3>
            {transferModal.error ? (
              <div className="mb-3 text-sm text-red-500">
                {transferModal.error}
              </div>
            ) : null}
            <label className={labelClass}>Registration Secret</label>
            <input
              className="input mb-4"
              value={transferModal.secret}
              onChange={(e) =>
                setTransferModal((m) => ({ ...m, secret: e.target.value }))
              }
            />
            <label className={labelClass}>Recipient Name</label>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur">
          <div className="card w-full max-w-lg p-6">
            <h3 className="mb-3 text-lg font-semibold text-slate-800">
              Revoke Transfer
            </h3>
            {revokeModal.error ? (
              <div className="mb-3 text-sm text-red-500">
                {revokeModal.error}
              </div>
            ) : null}
            <label className={labelClass}>Registration Secret</label>
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
        <div className="mb-1 break-words font-semibold text-slate-800">
          {name}
        </div>
      ) : null}
      {description ? (
        <div className="whitespace-pre-wrap break-words text-sm text-slate-600">
          {description}
        </div>
      ) : (
        <div className="text-sm text-slate-500">No description</div>
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
      <h3 className="mb-2 text-lg font-semibold text-slate-800">{title}</h3>
      <div className="animate-pulse">
        {withImage ? (
          <div className="mb-3 h-40 w-full rounded bg-slate-200" />
        ) : null}
        <div className="space-y-2">
          {Array.from({ length: lines }).map((_, i) => (
            <div key={i} className="h-3 rounded bg-slate-200" />
          ))}
        </div>
      </div>
    </div>
  );
}

function SkeletonList({ title, items = 3 }: { title: string; items?: number }) {
  return (
    <div className="card p-4">
      <h3 className="mb-2 text-lg font-semibold text-slate-800">{title}</h3>
      <div className="space-y-3 animate-pulse">
        {Array.from({ length: items }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="w-2/3 space-y-2">
              <div className="h-3 w-2/3 rounded bg-slate-200" />
              <div className="h-3 w-1/3 rounded bg-slate-200" />
            </div>
            <div className="h-8 w-20 rounded bg-slate-200" />
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
      onError={() => setLoaded(true)}
      className={`${className || ""} transition-opacity duration-300 ${
        loaded ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

function CidThumb({
  cid,
  size: _size = 300,
  className,
  ipfsGateway,
}: {
  cid: string;
  size?: number;
  className?: string;
  ipfsGateway: string;
}) {
  const [idx, setIdx] = useState(0);
  const gateways = [
    ipfsGateway,
    "https://cloudflare-ipfs.com/ipfs/:cid",
    "https://ipfs.io/ipfs/:cid",
  ];
  const base = (gateways[idx] || gateways[0]).replace(":cid", cid);
  const src = base;
  return (
    <img
      src={src}
      alt="Original certificate"
      className={className}
      onError={() => setIdx((i) => (i + 1 < gateways.length ? i + 1 : i))}
    />
  );
}

function UrlOrCidThumb({
  urlOrCid,
  size = 300,
  alt,
  className,
  ipfsGateway,
}: {
  urlOrCid: string;
  size?: number;
  alt: string;
  className?: string;
  ipfsGateway: string;
}) {
  const cid = extractCidFromUrlOrString(urlOrCid);
  const [attempt, setAttempt] = useState(0);
  if (cid) {
    return (
      <CidThumb
        cid={cid}
        size={size}
        className={className}
        ipfsGateway={ipfsGateway}
      />
    );
  }
  const withParam =
    toThumbFromUrlOrCid(urlOrCid, size, ipfsGateway) || urlOrCid;
  const plain = urlOrCid;
  const src = attempt === 0 ? withParam : plain;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setAttempt((a) => (a < 1 ? a + 1 : a))}
    />
  );
}

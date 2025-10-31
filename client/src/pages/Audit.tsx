import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { fetchAuditHistory, generateAuditProof } from "../lib/api";
import { ClvTag } from "../lib/clv";
import {
  DocumentArrowDownIcon,
  ArrowPathIcon,
  ClockIcon,
  LinkIcon,
} from "@heroicons/react/24/outline";

type AuditEntry = {
  id: number;
  filename: string;
  cid: string | null;
  url: string | null;
  ipfsUri?: string | null;
  source?: string | null;
  stampResponse?: any;
  createdAt: string;
};

export default function Audit() {
  const { authenticated, isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [responseModal, setResponseModal] = useState<AuditEntry | null>(null);

  const timestampLinkTemplate = (import.meta.env.VITE_TIMESTAMP_LINK as string) || "";

  const getTimestampUrl = () => {
    if (!timestampLinkTemplate) return null;
    return timestampLinkTemplate;
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAuditHistory();
      setHistory(data.history ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || "Failed to load audits");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authenticated && isAdmin) {
      load();
    }
  }, [authenticated, isAdmin]);

  const onGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const { audit } = await generateAuditProof();
      setHistory((prev) => [audit, ...prev]);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || "Failed to generate audit");
    } finally {
      setGenerating(false);
    }
  };

  if (!authenticated || !isAdmin) {
    return (
      <div className="card p-6">
        <h2 className="text-2xl font-semibold text-slate-800 mb-2">Admins only</h2>
        <p className="text-slate-500">You must be an admin to view audit history.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Audit History</h1>
            <p className="text-slate-500">
              Daily blockchain proofs of the audit will appear here. Generate a manual audit to create a new immutable record immediately.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {getTimestampUrl() ? (
              <a
                href={getTimestampUrl()!}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <LinkIcon className="h-4 w-4" aria-hidden="true" />
                View Timestamp
              </a>
            ) : null}
            <button
              type="button"
              className="btn inline-flex items-center gap-2"
              onClick={onGenerate}
              disabled={generating}
            >
              <ArrowPathIcon className={`h-5 w-5 ${generating ? "animate-spin" : ""}`} aria-hidden="true" />
              {generating ? "Generating..." : "Generate Audit"}
            </button>
          </div>
        </div>
        {error ? <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}
      </div>

      <div className="card p-6">
        {loading ? (
          <div className="text-slate-500">Loading audit history...</div>
        ) : history.length === 0 ? (
          <div className="text-slate-500">No audits generated yet.</div>
        ) : (
          <ul className="space-y-4">
            {history.map((entry) => (
              <li
                key={entry.id}
                className="border border-slate-200 rounded-xl p-4 space-y-3"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="flex-1 space-y-2 min-w-0">
                    <div className="flex items-center gap-2 text-slate-700 font-medium">
                      <DocumentArrowDownIcon className="h-5 w-5 text-autumn-700 shrink-0" aria-hidden="true" />
                      <span className="truncate">{entry.filename}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <ClockIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{new Date(entry.createdAt).toLocaleString()}</span>
                      </div>
                      {entry.source ? (
                        <span className="rounded-full bg-autumn-50 px-2 py-0.5 text-xs text-autumn-700 shrink-0">
                          {entry.source === "cron" ? "Scheduled" : "Manual"}
                        </span>
                      ) : null}
                    </div>
                    {entry.cid ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-slate-400 shrink-0">CID:</span>
                        <span className="text-xs text-slate-400 font-mono break-all">{entry.cid}</span>
                        <div className="shrink-0">
                          <ClvTag cid={entry.cid} />
                        </div>
                      </div>
                    ) : null}
                    {entry.ipfsUri ? (
                      <div className="text-xs text-slate-400 break-all font-mono">
                        {entry.ipfsUri}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {entry.url ? (
                      <a
                        href={entry.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-outline whitespace-nowrap"
                      >
                        Download
                      </a>
                    ) : null}
                    {entry.stampResponse ? (
                      <button
                        type="button"
                        onClick={() => setResponseModal(entry)}
                        className="btn-outline whitespace-nowrap text-sm"
                      >
                        Response
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Response Modal */}
      {responseModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur">
          <div className="card w-full max-w-4xl max-h-[90vh] p-6 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-800">
                Chainletter Response
              </h3>
              <button
                type="button"
                onClick={() => setResponseModal(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              <pre className="bg-slate-50 rounded-lg p-4 text-xs font-mono text-slate-700 overflow-auto border border-slate-200">
                {JSON.stringify(responseModal.stampResponse, null, 2)}
              </pre>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setResponseModal(null)}
                className="btn"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

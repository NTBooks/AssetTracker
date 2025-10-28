import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  clearRecentItems,
  getRecentItems,
  RecentItem,
  RECENT_EVENT,
} from "../lib/recent";
import { resolveIpfsCidToHttp, resolveIpfsThumb } from "../lib/ipfs";
import { initClVerify } from "../lib/clverify";
import { useAuth } from "../lib/auth";

export default function Layout() {
  const { pathname } = useLocation();
  const auth = useAuth();
  const NavLink = ({ to, children }: { to: string; children: any }) => (
    <Link
      className={`px-3 py-2 rounded-md ${
        pathname === to
          ? "bg-autumn-200 text-autumn-900"
          : "hover:bg-autumn-100"
      }`}
      to={to}>
      {children}
    </Link>
  );
  return (
    <div className="min-h-screen">
      {/* Initialize CLVerify once at layout mount */}
      <ClvBootstrap />
      {/* Global event toasts overlay */}
      <EventToasts />
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-autumn-100">
        <div className="max-w-6xl mx-auto flex items-center justify-between p-4">
          <Link to="/" className="font-bold text-autumn-700">
            Asset Tracker
          </Link>
          <nav className="flex gap-2 items-center">
            {auth.authenticated && auth.isAdmin ? (
              <NavLink to="/create">Create Item</NavLink>
            ) : null}
            <NavLink to="/register">Register Asset</NavLink>
            <NavLink to="/verify">Verify</NavLink>
            <AdminAuthButton />
          </nav>
        </div>
      </header>
      <div className="max-w-6xl mx-auto p-4 grid md:grid-cols-12 gap-4">
        <aside className="md:col-span-4 lg:col-span-3 order-2 md:order-1">
          <RecentSidebar />
          <EventsPanel />
        </aside>
        <main className="md:col-span-8 lg:col-span-9 order-1 md:order-2">
          <Outlet />
        </main>
      </div>
      <footer className="mt-16 py-8 text-center text-sm text-stone-500">
        Built with an autumn Tailwind theme
      </footer>
    </div>
  );
}

function RecentSidebar() {
  const [items, setItems] = useState<RecentItem[]>([]);
  useEffect(() => {
    setItems(getRecentItems());
    const onStorage = () => setItems(getRecentItems());
    window.addEventListener("storage", onStorage);
    window.addEventListener(RECENT_EVENT, onStorage as any);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const copy = (text: string) => navigator.clipboard.writeText(text);
  const onClear = () => {
    if (window.confirm("Clear recent items from this browser?")) {
      clearRecentItems();
      setItems([]);
    }
  };
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Recent</h3>
        <button
          className="text-sm text-autumn-700 hover:underline"
          onClick={onClear}>
          Clear
        </button>
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-stone-500">No recent items</div>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={`${it.kind}-${it.sku}-${it.serial}-${it.when}`}
              className="flex items-center justify-between">
              <div>
                <Link
                  to={`/verify?sku=${encodeURIComponent(
                    it.sku
                  )}&serial=${encodeURIComponent(it.serial)}`}
                  className="font-mono text-sm text-autumn-700 underline">
                  {it.sku}/{it.serial}
                </Link>
                <div className="text-xs text-stone-500">
                  {it.kind} • {new Date(it.when).toLocaleString()}
                </div>
              </div>
              {it.secret ? (
                <button
                  className="btn-outline text-sm"
                  onClick={() => copy(it.secret!)}>
                  Copy secret
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClvBootstrap() {
  useEffect(() => {
    initClVerify(document.body);
  }, []);
  return null;
}

function AdminAuthButton() {
  const { loading, authenticated, userEmail, stampsCredits, login, logout } =
    useAuth();
  if (loading) {
    return (
      <button className="btn-outline opacity-70 cursor-wait" disabled>
        Checking…
      </button>
    );
  }
  return authenticated ? (
    <div className="flex items-center gap-2">
      {userEmail ? (
        <span className="text-sm text-stone-600 hidden sm:inline">
          {userEmail}
          {typeof stampsCredits === "number"
            ? ` (${stampsCredits} stamps)`
            : ""}
        </span>
      ) : null}
      <button className="btn-outline" onClick={logout}>
        Logout
      </button>
    </div>
  ) : (
    <button className="btn" onClick={login}>
      Admin Login
    </button>
  );
}

type EventLine = {
  id: string;
  type: string;
  time: string;
  name?: string;
  cid?: string;
  thumb?: string;
};

function EventsPanel() {
  const [lines, setLines] = useState<EventLine[]>([]);
  useEffect(() => {
    const es = new EventSource("/api/events/stream");
    es.onmessage = (ev) => {
      try {
        const obj = JSON.parse(ev.data);
        const cid = obj?.data?.hash || obj?.data?.cid;
        const thumb = cid ? resolveIpfsThumb(cid, 300) || undefined : undefined;
        const line: EventLine = {
          id: String(obj?.id || crypto.randomUUID?.() || Date.now()),
          type: String(obj?.type || "event"),
          time: new Date(obj?.timestamp || Date.now()).toLocaleTimeString(),
          name: obj?.data?.name,
          cid,
          thumb,
        };
        setLines((prev) => [line, ...prev].slice(0, 100));
      } catch {
        // ignore non-JSON
      }
    };
    es.onerror = () => {
      /* keep open; server will end on error */
    };
    return () => es.close();
  }, []);
  return (
    <div className="card p-4 mt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Events</h3>
      </div>
      <div className="text-xs max-h-64 overflow-auto space-y-2">
        {lines.length === 0 ? (
          <div className="text-stone-500">Awaiting events…</div>
        ) : (
          lines.map((l) =>
            l.type === "file.uploaded" && l.thumb ? (
              <a
                key={l.id}
                href={l.thumb}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2">
                <img
                  src={l.thumb}
                  alt="thumb"
                  className="w-8 h-8 object-cover rounded border"
                />
                <div className="flex-1">
                  <div className="font-medium">
                    {l.type} <span className="text-stone-500">{l.time}</span>
                  </div>
                  <div className="text-stone-600 truncate">
                    {l.name || l.cid || "—"}
                  </div>
                </div>
              </a>
            ) : (
              <div key={l.id} className="flex items-center gap-2">
                {l.thumb ? (
                  <img
                    src={l.thumb}
                    alt="thumb"
                    className="w-8 h-8 object-cover rounded border"
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-autumn-100" />
                )}
                <div className="flex-1">
                  <div className="font-medium">
                    {l.type} <span className="text-stone-500">{l.time}</span>
                  </div>
                  <div className="text-stone-600 truncate">
                    {l.name || l.cid || "—"}
                  </div>
                </div>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
}

function EventToasts() {
  const [toasts, setToasts] = useState<EventLine[]>([]);
  const timers = (globalThis as any).__toastTimers || new Map<string, any>();
  (globalThis as any).__toastTimers = timers;
  useEffect(() => {
    const es = new EventSource("/api/events/stream");
    es.onmessage = (ev) => {
      try {
        const obj = JSON.parse(ev.data);
        const cid = obj?.data?.hash || obj?.data?.cid;
        const thumb = cid ? resolveIpfsCidToHttp(cid) : undefined;
        const line: EventLine = {
          id: String(obj?.id || crypto.randomUUID?.() || Date.now()),
          type: String(obj?.type || "event"),
          time: new Date(obj?.timestamp || Date.now()).toLocaleTimeString(),
          name: obj?.data?.name,
          cid,
          thumb,
        };
        setToasts((prev) => {
          const next = [line, ...prev].slice(0, 6);
          return next;
        });
        const t = setTimeout(() => {
          setToasts((prev) => prev.filter((x) => x.id !== line.id));
          timers.delete(line.id);
        }, 6000);
        timers.set(line.id, t);
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      /* keep open */
    };
    return () => {
      es.close();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto card p-3 shadow-lg bg-white border flex items-center gap-3 min-w-[260px]">
          {t.thumb ? (
            <img
              src={t.thumb}
              alt="thumb"
              className="w-8 h-8 object-cover rounded border"
            />
          ) : (
            <div className="w-8 h-8 rounded bg-autumn-100" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {t.type} <span className="text-stone-500">{t.time}</span>
            </div>
            <div className="text-xs text-stone-600 truncate">
              {t.name || t.cid || "—"}
            </div>
          </div>
          <button
            className="text-stone-400 hover:text-stone-600"
            onClick={() => {
              const tm = timers.get(t.id);
              if (tm) clearTimeout(tm);
              timers.delete(t.id);
              setToasts((prev) => prev.filter((x) => x.id !== t.id));
            }}
            aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

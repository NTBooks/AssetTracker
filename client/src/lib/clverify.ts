import { CL_TENANT } from "./env";

declare global {
  interface Window {
    CLVerify?: { scan: (root?: Element | Document) => void };
    __CLV_ALREADY_LOADED__?: any;
  }
}

export async function ensureClVerifyScript(): Promise<void> {
  try {
    if (window.CLVerify && typeof window.CLVerify.scan === "function") return;
    const existing = document.querySelector(
      'script[data-clverify="1"]'
    ) as HTMLScriptElement | null;
    if (existing && existing.parentNode)
      existing.parentNode.removeChild(existing);
    try {
      if (window.__CLV_ALREADY_LOADED__) delete window.__CLV_ALREADY_LOADED__;
    } catch {}
    const s = document.createElement("script");
    s.src = `https://${CL_TENANT}/widget/clverify.js?v=${Date.now()}`;
    s.async = true;
    s.setAttribute("data-clverify", "1");
    document.head.appendChild(s);
    await new Promise<void>((res) => {
      s.onload = () => res();
      s.onerror = () => res();
      setTimeout(res, 1200);
    });
  } catch {}
}

export function startClVerifyAutoScan(
  root: Element | Document = document.body
): MutationObserver | null {
  try {
    // Initial scan
    try {
      window.CLVerify && window.CLVerify.scan(root as any);
    } catch {}
    const observer = new MutationObserver((mutations) => {
      let should = false;
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if ((node as any)?.nodeType === 1) {
            const el = node as Element;
            const tag = el.tagName?.toLowerCase?.() || "";
            if (
              tag === "clverify" ||
              el.hasAttribute?.("cid") ||
              el.querySelector?.("a[cid], clverify")
            ) {
              should = true;
              break;
            }
          }
        }
        if (should) break;
      }
      if (should) {
        try {
          window.CLVerify && window.CLVerify.scan(root as any);
        } catch {}
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return observer;
  } catch {
    return null;
  }
}

export async function initClVerify(
  root: Element | Document = document.body
): Promise<MutationObserver | null> {
  await ensureClVerifyScript();
  return startClVerifyAutoScan(root);
}

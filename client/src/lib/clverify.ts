const CL_TENANT =
  (import.meta.env.VITE_CL_TENANT as string) || "lakeview.chaincart.io";

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

export async function initClVerify(
  root: Element | Document = document.body
): Promise<MutationObserver | null> {
  await ensureClVerifyScript();
  return null;
}

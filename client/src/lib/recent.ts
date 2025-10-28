export type RecentItem = {
  sku: string;
  serial: string;
  itemName?: string;
  when: number; // epoch ms
  secret?: string; // initial or next secret if available
  kind: "created" | "registered";
};

const KEY = "assetTracker.recentItems.v1";
const MAX = 20;
export const RECENT_EVENT = "assetTracker.recentItems.updated";

export function getRecentItems(): RecentItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr as RecentItem[];
  } catch {
    return [];
  }
}

export function addRecentItem(
  item: Omit<RecentItem, "when"> & { when?: number }
) {
  const list = getRecentItems();
  const when = item.when ?? Date.now();
  // Append without de-duplicating so repeated actions on same SKU/Serial are kept
  const next = [{ ...item, when }, ...list].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(next));
  try {
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch {}
}

export function clearRecentItems() {
  localStorage.removeItem(KEY);
  try {
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch {}
}

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type AppConfig = {
  loading: boolean;
  singleSku: string | null;
  contestReasons: string[];
};

const ConfigContext = createContext<AppConfig | undefined>(undefined);

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [singleSku, setSingleSku] = useState<string | null>(null);
  const [contestReasons, setContestReasons] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setSingleSku(json?.data?.singleSku || null);
        const reasons = Array.isArray(json?.data?.contestReasons)
          ? json.data.contestReasons.filter(
              (s: any) => typeof s === "string" && s.trim().length > 0
            )
          : [];
        setContestReasons(reasons);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ loading, singleSku, contestReasons }),
    [loading, singleSku, contestReasons]
  );
  return (
    <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
  );
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used within ConfigProvider");
  return ctx;
}

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { API_BASE_URL, IS_SAME_ORIGIN } from "./api";

type AppConfig = {
  loading: boolean;
  singleSku: string | null;
  contestReasons: string[];
  clTenant: string;
  ipfsGateway: string;
  hideLogin: boolean;
  timestampLink: string;
};

const ConfigContext = createContext<AppConfig | undefined>(undefined);

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [singleSku, setSingleSku] = useState<string | null>(null);
  const [contestReasons, setContestReasons] = useState<string[]>([]);
  const [clTenant, setClTenant] = useState<string>("lakeview.chaincart.io");
  const [ipfsGateway, setIpfsGateway] = useState<string>("https://gateway.pinata.cloud/ipfs/:cid");
  const [hideLogin, setHideLogin] = useState<boolean>(false);
  const [timestampLink, setTimestampLink] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const base = (API_BASE_URL || "").replace(/\/+$/, "");
    fetch(`${base}/api/config`, {
      credentials: IS_SAME_ORIGIN ? "include" : "omit",
    })
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
        setClTenant(json?.data?.clTenant || "lakeview.chaincart.io");
        setIpfsGateway(json?.data?.ipfsGateway || "https://gateway.pinata.cloud/ipfs/:cid");
        setHideLogin(json?.data?.hideLogin === true);
        setTimestampLink(json?.data?.timestampLink || "");
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
    () => ({ loading, singleSku, contestReasons, clTenant, ipfsGateway, hideLogin, timestampLink }),
    [loading, singleSku, contestReasons, clTenant, ipfsGateway, hideLogin, timestampLink]
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

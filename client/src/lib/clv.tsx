import React, { useEffect } from "react";
import { useConfig } from "./config";

type ClvLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  cid: string;
};

export function ClvLink({ cid, ...props }: ClvLinkProps) {
  const { clTenant } = useConfig();
  useEffect(() => {
    try {
      (window as any).CLVerify && (window as any).CLVerify.scan(document.body);
    } catch {}
  }, [cid]);
  return <a {...props} {...({ cid, api: clTenant, mode: "dark" } as any)} />;
}

type ClvTagProps = React.HTMLAttributes<HTMLElement> & {
  cid: string;
};

export function ClvTag({ cid, ...props }: ClvTagProps) {
  const { clTenant } = useConfig();
  useEffect(() => {
    try {
      (window as any).CLVerify && (window as any).CLVerify.scan(document.body);
    } catch {}
  }, [cid]);
  return React.createElement("clverify", {
    ...props,
    cid,
    api: clTenant,
    mode: "dark",
  } as any);
}

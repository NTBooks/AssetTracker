import React, { useEffect } from "react";

const CL_TENANT =
  (import.meta.env.VITE_CL_TENANT as string) || "lakeview.chaincart.io";

type ClvLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  cid: string;
};

export function ClvLink({ cid, ...props }: ClvLinkProps) {
  useEffect(() => {
    try {
      (window as any).CLVerify && (window as any).CLVerify.scan(document.body);
    } catch {}
  }, [cid]);
  return <a {...props} cid={cid} api={CL_TENANT} />;
}

type ClvTagProps = React.HTMLAttributes<HTMLElement> & {
  cid: string;
};

export function ClvTag({ cid, ...props }: ClvTagProps) {
  useEffect(() => {
    try {
      (window as any).CLVerify && (window as any).CLVerify.scan(document.body);
    } catch {}
  }, [cid]);
  return React.createElement("clverify", {
    ...props,
    cid,
    api: CL_TENANT,
  } as any);
}

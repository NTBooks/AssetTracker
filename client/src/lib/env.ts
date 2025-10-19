export const TESTMODE = import.meta.env.DEV === true;
export const CL_TENANT =
  (import.meta.env.VITE_CL_TENANT as string) || "lakeview.chaincart.io";

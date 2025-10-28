import axios from "axios";

// Ensure cookies are sent for proxied same-origin routes (login/checklogin/logout)
axios.defaults.withCredentials = true;

export async function generateSerial() {
  const { data } = await axios.post("/api/generate-serial");
  return data.data as { sku: string; serial: string };
}

export async function createCheckout(
  description: string,
  successUrl: string,
  cancelUrl: string
) {
  const { data } = await axios.post("/api/checkout", {
    description,
    successUrl,
    cancelUrl,
  });
  return data.data as { id: string; url: string };
}

export async function createItem(payload: {
  sku: string;
  serial: string;
  itemName?: string;
  itemDescription?: string;
  photoUrl?: string;
  stampNow?: boolean; // legacy: applies to both
  stampNowPublic?: boolean;
  stampNowPrivate?: boolean;
}) {
  const { data } = await axios.post("/api/items", payload);
  return data.data as {
    sku: string;
    serial: string;
    initialSecret: string;
    certificateUrl?: string | null;
    nextSecretUrl?: string | null;
  };
}

export async function registerAsset(payload: {
  sku: string;
  serial: string;
  ownerName: string;
  unlockSecret: string;
}) {
  const { data } = await axios.post("/api/registrations", payload);
  return data.data as {
    registrationId: number;
    publicUrl?: string | null;
    privateUrl?: string | null;
    nextSecret: string;
  };
}

export async function verifyQuery(sku: string, serial: string) {
  const { data } = await axios.get("/api/verify", { params: { sku, serial } });
  return data.data as {
    serial: any;
    registrations: Array<{
      id: number;
      owner_name: string;
      created_at: string;
      contested: number;
      public_file_url?: string | null;
    }>;
  };
}

export async function contestRegistration(
  registrationId: number,
  secret: string,
  reason: string
) {
  const { data } = await axios.post("/api/contest", {
    registrationId,
    secret,
    reason,
  });
  return data.data;
}

export async function checkLogin() {
  const { data } = await axios.get("/checklogin");
  return data as {
    status: "success" | "error";
    message: string;
    authenticated: boolean;
    isAdmin?: boolean;
    user?: { email: string } | null;
  };
}

export async function getStamps() {
  const { data } = await axios.get("/api/stamps", {
    params: { network: "all" },
  });
  return (data?.data?.credits ?? null) as number | null;
}

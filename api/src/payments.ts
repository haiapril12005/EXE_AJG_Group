import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

type PayOSValue = string | number | boolean | null | undefined;
type PayOSData = Record<string, PayOSValue>;

function canonicalValue(value: PayOSValue): string {
  return value === null || value === undefined ? "" : String(value);
}

export function signPayOSData(data: PayOSData): string {
  if (!config.PAYOS_CHECKSUM_KEY) throw new Error("PAYOS_CHECKSUM_KEY is not configured");
  const canonical = Object.keys(data)
    .sort()
    .map((key) => `${key}=${canonicalValue(data[key])}`)
    .join("&");
  return createHmac("sha256", config.PAYOS_CHECKSUM_KEY).update(canonical).digest("hex");
}

export function verifyPayOSWebhook(body: unknown): body is {
  data: Record<string, unknown> & { orderCode: number; amount: number; code: string };
  signature: string;
} {
  if (!body || typeof body !== "object") return false;
  const payload = body as { data?: unknown; signature?: unknown };
  if (!payload.data || typeof payload.data !== "object" || typeof payload.signature !== "string") {
    return false;
  }

  const data = payload.data as Record<string, unknown>;
  if (typeof data.orderCode !== "number" || typeof data.amount !== "number" || typeof data.code !== "string") {
    return false;
  }
  if (Object.values(data).some((value) => value !== null && !["string", "number", "boolean"].includes(typeof value))) {
    return false;
  }

  const expected = signPayOSData(data as PayOSData);
  const actualBuffer = Buffer.from(payload.signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function createPayOSPayment(orderCode: number, amount: number, description: string) {
  if (!config.PAYOS_CLIENT_ID || !config.PAYOS_API_KEY || !config.PAYOS_CHECKSUM_KEY) {
    throw new Error("Configure PAYOS_CLIENT_ID, PAYOS_API_KEY, and PAYOS_CHECKSUM_KEY to enable payments");
  }
  const data = {
    orderCode,
    amount,
    description,
    cancelUrl: config.PAYOS_CANCEL_URL ?? `${config.WEB_ORIGIN}/?payment=cancelled`,
    returnUrl: config.PAYOS_RETURN_URL ?? `${config.WEB_ORIGIN}/?payment=success`
  };
  const response = await fetch("https://api-merchant.payos.vn/v2/payment-requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": config.PAYOS_CLIENT_ID,
      "x-api-key": config.PAYOS_API_KEY
    },
    body: JSON.stringify({ ...data, signature: signPayOSData(data) })
  });
  const result = await response.json() as {
    code?: string;
    desc?: string;
    data?: { checkoutUrl?: string; qrCode?: string };
  };
  if (!response.ok || result.code !== "00" || !result.data?.checkoutUrl) {
    throw new Error(`PayOS payment creation failed: ${result.desc ?? response.statusText}`);
  }
  return { checkoutUrl: result.data.checkoutUrl, qrCode: result.data.qrCode ?? null };
}

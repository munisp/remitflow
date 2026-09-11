/**
 * Broker Adapter (G2 — honest broker execution layer)
 *
 * Single integration point between ngx order placement and the executing
 * broker. HARD RULES:
 *   - NEVER mock a fill. An adapter either gets a real 2xx acceptance from
 *     the broker's API or reports { accepted: false }.
 *   - Missing config / non-2xx / network error / timeout => accepted:false.
 *     The order stays `pending_broker` and is reconciled manually by ops.
 *   - executedAt is set ONLY by the (future) broker webhook handler after an
 *     HMAC-verified fill notification — never here.
 *
 * Configuration per broker (env):
 *   BROKER_<NAME>_API_URL — base endpoint for order submission (https only)
 *   BROKER_<NAME>_API_KEY — bearer credential + HMAC key for signing
 * e.g. brokerName "Bamboo" => BROKER_BAMBOO_API_URL / BROKER_BAMBOO_API_KEY
 *
 * Request contract (HttpBrokerAdapter):
 *   POST {apiUrl}/orders
 *   Headers: Authorization: Bearer <key>, X-Broker-Signature: <hmac-sha256
 *            hex of the raw JSON body with the api key>,
 *            X-Idempotency-Key: <order brokerReference (unique per order)>
 *   Body: { reference, ticker, side, orderType, quantityUnits,
 *           pricePerUnitNgn, totalAmountNgn }
 *   2xx with optional JSON { brokerReference | reference | id } => accepted.
 */
import crypto from "crypto";
import { logger } from "../_core/logger.js";

const SUBMIT_TIMEOUT_MS = 15_000;

export interface BrokerOrder {
  /** internal order id */
  id: number;
  /** our unique reference — also used as the broker idempotency key */
  reference: string;
  ticker: string;
  orderType: "buy" | "sell" | "limit_buy" | "limit_sell";
  quantityUnits: string;
  pricePerUnitNgn: string;
  totalAmountNgn: string;
}

export interface BrokerSubmitResult {
  accepted: boolean;
  brokerReference?: string;
  reason?: string;
}

export interface BrokerAdapter {
  readonly name: string;
  submitOrder(order: BrokerOrder): Promise<BrokerSubmitResult>;
}

/** Fail-closed adapter used when a broker has no configured endpoint. */
class NullBrokerAdapter implements BrokerAdapter {
  constructor(public readonly name: string) {}
  async submitOrder(): Promise<BrokerSubmitResult> {
    return { accepted: false, reason: "broker_not_configured" };
  }
}

class HttpBrokerAdapter implements BrokerAdapter {
  constructor(
    public readonly name: string,
    private readonly apiUrl: string,
    private readonly apiKey: string,
  ) {}

  private sign(rawBody: string): string {
    return crypto.createHmac("sha256", this.apiKey).update(rawBody).digest("hex");
  }

  async submitOrder(order: BrokerOrder): Promise<BrokerSubmitResult> {
    const rawBody = JSON.stringify({
      reference: order.reference,
      ticker: order.ticker,
      side: order.orderType.startsWith("limit_") ? order.orderType.slice(6) : order.orderType,
      orderType: order.orderType,
      quantityUnits: order.quantityUnits,
      pricePerUnitNgn: order.pricePerUnitNgn,
      totalAmountNgn: order.totalAmountNgn,
    });
    let res: Response;
    try {
      res = await fetch(`${this.apiUrl.replace(/\/+$/, "")}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "X-Broker-Signature": this.sign(rawBody),
          "X-Idempotency-Key": order.reference,
        },
        body: rawBody,
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      });
    } catch (err) {
      logger.warn({ broker: this.name, orderId: order.id, err: err instanceof Error ? err.message : String(err) },
        "[Broker] submit failed (network/timeout) — order stays pending_broker");
      return { accepted: false, reason: "broker_unreachable" };
    }
    if (!res.ok) {
      logger.warn({ broker: this.name, orderId: order.id, status: res.status },
        "[Broker] submit rejected — order stays pending_broker");
      return { accepted: false, reason: `broker_http_${res.status}` };
    }
    let brokerReference: string | undefined;
    try {
      const data = (await res.json()) as { brokerReference?: string; reference?: string; id?: string | number };
      const ref = data.brokerReference ?? data.reference ?? (data.id != null ? String(data.id) : undefined);
      if (ref && typeof ref === "string" && ref.length <= 100) brokerReference = ref;
    } catch {
      // 2xx without a parseable body is still an acceptance.
    }
    return { accepted: true, brokerReference };
  }
}

function brokerEnvKey(brokerName: string): string {
  return brokerName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

export function getBrokerAdapter(brokerName: string): BrokerAdapter {
  const key = brokerEnvKey(brokerName);
  const apiUrl = process.env[`BROKER_${key}_API_URL`];
  const apiKey = process.env[`BROKER_${key}_API_KEY`];
  if (!apiUrl || !apiKey) return new NullBrokerAdapter(brokerName);
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    logger.warn({ broker: brokerName }, "[Broker] invalid BROKER_*_API_URL — treating as unconfigured");
    return new NullBrokerAdapter(brokerName);
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    logger.warn({ broker: brokerName }, "[Broker] non-https BROKER_*_API_URL — treating as unconfigured");
    return new NullBrokerAdapter(brokerName);
  }
  return new HttpBrokerAdapter(brokerName, apiUrl, apiKey);
}

/**
 * Verify an inbound broker webhook signature: HMAC-SHA256 hex of the raw
 * payload with BROKER_<NAME>_API_KEY, timing-safe compare. Returns false
 * (fail closed) when the broker is not configured.
 */
export function verifyBrokerWebhookSignature(brokerName: string, rawPayload: string, signature: string): boolean {
  const key = brokerEnvKey(brokerName);
  const apiKey = process.env[`BROKER_${key}_API_KEY`];
  if (!apiKey || !signature) return false;
  const expected = crypto.createHmac("sha256", apiKey).update(rawPayload).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

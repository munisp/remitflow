import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // The Manus sandbox proxy always serves HTTPS externally but may not forward
  // x-forwarded-proto reliably. Force secure=true for known sandbox/production hostnames.
  const hostname = req.hostname ?? "";
  const productionDomain = process.env.REMITFLOW_PRODUCTION_DOMAIN ?? "";
  const isManagedProxy =
    hostname.includes("remitflow.app") ||
    (productionDomain && hostname.includes(productionDomain)) ||
    process.env.NODE_ENV === "production";

  const isSecure = isSecureRequest(req) || isManagedProxy;

  return {
    httpOnly: true,
    path: "/",
    // SameSite=Lax blocks CSRF while allowing OAuth redirects (top-level navigations)
    sameSite: "lax",
    secure: isSecure,
  };
}

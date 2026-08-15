/**
 * RemitFlow React Native — tRPC client factory
 *
 * REAL client: connects to the platform API over HTTP batch links with the
 * superjson transformer (same as the server). The base URL comes from
 * src/services/apiConfig.ts (EXPO_PUBLIC_API_URL / REMITFLOW_API_URL); when
 * no API URL is configured the factory FAILS LOUDLY instead of pointing at a
 * fabricated default host.
 */
import { createTRPCReact } from "@trpc/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { apiUrl } from "../services/apiConfig";
import type { MobileAppRouter } from "../types/trpcContract";

/** React hooks for the tRPC API (e.g. trpc.stablecoinPlatform.onramp.useMutation()). */
export const trpc = createTRPCReact<MobileAppRouter>();

function trpcLink() {
  return httpBatchLink({
    // apiUrl() throws when EXPO_PUBLIC_API_URL/REMITFLOW_API_URL is unset —
    // intentional: an unconfigured build must fail loudly, not silently no-op.
    url: apiUrl("/api/trpc"),
    transformer: superjson,
  });
}

/**
 * Create a vanilla (non-React) tRPC client. Call once and share the instance
 * (e.g. module scope of a service); the client is stateless and cheap, but a
 * single instance keeps batching effective.
 */
export function createMobileTrpcClient() {
  return createTRPCClient<MobileAppRouter>({ links: [trpcLink()] });
}

/**
 * Client options for <trpc.Provider client={...}>. Deferred through a factory
 * so importing this module never touches the network configuration until the
 * app actually mounts the provider.
 */
export function createTrpcClientForProvider() {
  return trpc.createClient({ links: [trpcLink()] });
}

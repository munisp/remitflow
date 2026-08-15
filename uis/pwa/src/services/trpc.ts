/**
 * tRPC client for RemitFlow PWA
 * Connects to the RemitFlow API server using HTTP batch links.
 */
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../types/appRouter";

export const trpc = createTRPCReact<AppRouter>();

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  import.meta.env.VITE_CORE_BANKING_URL ??
  "";

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: `${API_BASE_URL}/api/trpc`,
      transformer: superjson,
      async headers() {
        // Include session cookie for auth — browser sends cookies automatically
        // but we include the header for explicit session tracking
        return {};
      },
    }),
  ],
});

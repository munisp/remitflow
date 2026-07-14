/**
 * tRPC client for RemitFlow React Native app
 * Connects to the RemitFlow API server
 */
import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppRouter } from '../../../../server/routers';

export const trpc = createTRPCReact<AppRouter>();

const API_BASE_URL = process.env.REMITFLOW_API_URL ?? 'https://remitflow.app';

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: `${API_BASE_URL}/api/trpc`,
      transformer: superjson,
      async headers() {
        const sessionId = await AsyncStorage.getItem('session_id');
        return sessionId ? { Cookie: `app_session_id=${sessionId}` } : {};
      },
    }),
  ],
});

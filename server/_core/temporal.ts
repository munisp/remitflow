/**
 * Temporal Workflow Client — graceful stub
 *
 * Returns a Temporal client when TEMPORAL_ADDRESS is configured,
 * otherwise returns null so callers can skip workflow orchestration
 * without crashing.
 */

export interface TemporalClient {
  workflow: {
    start: (workflowType: string, options: {
      taskQueue: string;
      workflowId: string;
      args?: unknown[];
    }) => Promise<{ workflowId: string; firstExecutionRunId: string }>;
    getHandle: (workflowId: string) => Promise<{
      query: (queryName: string) => Promise<unknown>;
      signal: (signalName: string, args?: unknown[]) => Promise<void>;
      terminate: (reason?: string) => Promise<void>;
    }>;
  };
}

let _client: TemporalClient | null = null;

/**
 * Returns a Temporal client if TEMPORAL_ADDRESS is set, otherwise null.
 * Caches the client after first successful connection.
 */
export async function getTemporalClient(): Promise<TemporalClient | null> {
  const address = process.env.TEMPORAL_ADDRESS;
  if (!address) return null;
  if (_client) return _client;
  try {
    const { Client, Connection } = await import("@temporalio/client");
    const connection = await Connection.connect({ address });
    const client = new Client({ connection });
    _client = {
      workflow: {
        start: async (workflowType, options) => {
          const handle = await client.workflow.start(workflowType as any, {
            taskQueue: options.taskQueue,
            workflowId: options.workflowId,
            args: options.args as any,
          });
          return { workflowId: handle.workflowId, firstExecutionRunId: handle.firstExecutionRunId };
        },
        getHandle: async (workflowId) => {
          const handle = client.workflow.getHandle(workflowId);
          return {
            query: (queryName) => handle.query(queryName as any),
            signal: (signalName, args) => handle.signal(signalName as any, ...(args ?? [])),
            terminate: async (reason) => { await handle.terminate(reason); },
          };
        },
      },
    };
    return _client;
  } catch (err) {
    console.warn("[Temporal] Client unavailable:", (err as Error).message);
    return null;
  }
}

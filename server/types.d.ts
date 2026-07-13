declare module "tigerbeetle-node" {
  export function createClient(options: { cluster_id: bigint; replica_addresses: string[] }): any;
}

declare module "kafkajs" {
  export enum logLevel { NOTHING = 0, ERROR = 1, WARN = 2, INFO = 4, DEBUG = 5 }
  export enum CompressionTypes { None = 0, GZIP = 1, Snappy = 2, LZ4 = 3, ZSTD = 4 }
  export interface Producer {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    send(record: { topic: string; messages: Array<{ key?: string; value: string; headers?: Record<string, Buffer> }>; compression?: CompressionTypes }): Promise<any>;
  }
  export interface Consumer {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    subscribe(options: { topics: string[]; fromBeginning?: boolean } | { topic: string; fromBeginning?: boolean }): Promise<void>;
    run(config: { eachMessage: (payload: { topic: string; partition: number; message: any }) => Promise<void> }): Promise<void>;
  }
  export interface Admin {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    listTopics(): Promise<string[]>;
    createTopics(options: { topics: Array<{ topic: string; numPartitions?: number; replicationFactor?: number }> }): Promise<boolean>;
  }
  export class Kafka {
    constructor(config: { clientId: string; brokers: string[]; logLevel?: logLevel; retry?: any; ssl?: any; sasl?: any });
    producer(config?: { allowAutoTopicCreation?: boolean }): Producer;
    consumer(config: { groupId: string }): Consumer;
    admin(): Admin;
  }
}

declare module "@temporalio/client" {
  export class Connection {
    static connect(options: { address: string }): Promise<Connection>;
  }
  export interface WorkflowHandle<T = unknown> {
    workflowId: string;
    firstExecutionRunId: string;
    result(): Promise<T>;
    signal(signalName: string, ...args: unknown[]): Promise<void>;
    query(queryType: string, ...args: unknown[]): Promise<unknown>;
    cancel(): Promise<void>;
    terminate(reason?: string): Promise<void>;
    describe(): Promise<{ status: { name: string; code: number }; type: { name: string }; startTime: Date; closeTime?: Date }>;
  }
  export class Client {
    constructor(options: { connection: Connection; namespace?: string });
    workflow: {
      start(workflowType: string | Function, options: { workflowId: string; taskQueue: string; args?: unknown[]; searchAttributes?: Record<string, unknown[]> }): Promise<WorkflowHandle>;
      getHandle(workflowId: string): WorkflowHandle;
    };
  }
}

declare module "@growthbook/growthbook" {
  export class GrowthBook {
    constructor(options: any);
    loadFeatures(): Promise<void>;
    setAttributes(attrs: Record<string, any>): void;
    getFeatureValue(key: string, fallback: any): any;
    isOn(key: string): boolean;
    run(experiment: any): { value: any; variationId: number };
    getAllResults(): Map<string, any>;
    destroy(): void;
  }
}

declare module "@sentry/react" {
  export function init(options: any): void;
  export function setUser(user: any): void;
  export function addBreadcrumb(breadcrumb: any): void;
  export function captureException(error: any, context?: any): string;
  export function captureMessage(message: string, level?: string): string;
  export function startTransaction(context: any): any;
  export function configureScope(callback: (scope: any) => void): void;
  export function withScope(callback: (scope: any) => void): void;
}

declare module "@sentry/tracing" {
  export class BrowserTracing {
    constructor(options?: any);
  }
}

declare module "africastalking" {
  interface ATConfig {
    apiKey: string;
    username: string;
  }
  interface SMSOptions {
    to: string[];
    message: string;
    from?: string;
  }
  interface SMS {
    send(options: SMSOptions): Promise<any>;
  }
  interface AfricasTalking {
    SMS: SMS;
  }
  function africastalking(config: ATConfig): AfricasTalking;
  export = africastalking;
}

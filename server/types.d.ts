// NOTE: tigerbeetle-node, kafkajs and @temporalio/client ship their own type
// declarations; the previous hand-rolled shadows here hid real API mismatches
// and were removed. Only packages with no bundled types remain declared below.

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

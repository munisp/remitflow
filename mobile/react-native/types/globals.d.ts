/**
 * TYPE-LEVEL SHIM for React Native runtime globals — NOT a runtime mock.
 *
 * react-native polyfills fetch/AbortController/timers at runtime (via
 * whatwg-fetch and the JSC/Hermes environment). Since this tree doesn't
 * install react-native, declare exactly the globals our src/ code uses so
 * strict typechecking works without pulling in DOM lib types that do not
 * exist on device. Delete this file if a real RN install is added.
 */

declare function setTimeout(handler: () => void, timeout: number): number;
declare function clearTimeout(id: number): void;
declare function setInterval(handler: () => void, interval: number): number;
declare function clearInterval(id: number): void;

declare const console: {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

declare class AbortController {
  readonly signal: AbortSignal;
  abort(): void;
}

declare interface AbortSignal {
  readonly aborted: boolean;
}

declare interface Response {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

declare function fetch(
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    credentials?: "omit" | "same-origin" | "include";
    signal?: AbortSignal;
  },
): Promise<Response>;

/**
 * Microservice Auto-Start Launcher
 *
 * Spawns the three polyglot microservices as child processes when the
 * Node.js dev server starts. Each process is restarted on unexpected exit.
 *
 * Services:
 *   - Go FX Engine     → port 8081
 *   - Python Fraud ML  → port 8082
 *   - Rust AML Engine  → port 8083
 *
 * In production (Docker Compose), these are managed by Docker — this
 * launcher is only active in development (NODE_ENV !== 'production').
 */

import { spawn, execSync, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { logger } from "./logger.js";

const SERVICES_DIR = path.resolve(process.cwd(), "services");

interface ServiceConfig {
  name: string;
  dir: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  port: number;
  binaryPath?: string; // pre-built binary path
}

const SERVICES: ServiceConfig[] = [
  // ── Legacy services (kept for backward compatibility) ──────────────────
  {
    name: "fx-engine",
    dir: path.join(SERVICES_DIR, "fx-engine"),
    command: "/usr/local/go/bin/go",
    args: ["run", "main.go"],
    env: { PORT: "8081", GIN_MODE: "debug" },
    port: 8081,
    binaryPath: path.join(SERVICES_DIR, "fx-engine", "fx-engine"),
  },
  // ── v94+ Polyglot Microservices ────────────────────────────────────────
  {
    // Go: sliding-window rate limiting + input validation + idempotency
    name: "go-ratelimit-sidecar",
    dir: path.join(SERVICES_DIR, "go-ratelimit-sidecar"),
    command: "/usr/local/go/bin/go",
    args: ["run", "main.go"],
    env: { PORT: "8084", GO_ENV: "development" },
    port: 8084,
    binaryPath: path.join(SERVICES_DIR, "go-ratelimit-sidecar", "bin", "ratelimit-sidecar"),
  },
  {
    // Rust: tamper-evident audit log with ring buffer + integrity verification
    name: "rust-audit-service",
    dir: path.join(SERVICES_DIR, "rust-audit-service"),
    command: path.join(SERVICES_DIR, "rust-audit-service", "target", "release", "audit-service"),
    args: [],
    env: { PORT: "8082", RUST_LOG: "info" },
    port: 8082,
    binaryPath: path.join(SERVICES_DIR, "rust-audit-service", "target", "release", "audit-service"),
  },
  {
    // Python: AML/KYC compliance checks + fraud scoring + sanctions screening
    // Fix: use `python3 -m uvicorn` to avoid SRE module mismatch with python3.11 rc1
    name: "python-compliance-service",
    dir: path.join(SERVICES_DIR, "python-compliance-service"),
    command: "python3",
    args: ["-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8083"],
    env: { PORT: "8083", PYTHONUNBUFFERED: "1" },
    port: 8083,
  },
  {
    // Rust: Bloomberg BMATCH FX rate engine — CBN-compliant rate feed
    name: "rust-bmatch-engine",
    dir: path.join(SERVICES_DIR, "rust-bmatch-engine"),
    command: path.join(SERVICES_DIR, "rust-bmatch-engine", "target", "release", "bmatch-engine"),
    args: [],
    env: { PORT: "8097", RUST_LOG: "info" },
    port: 8097,
    binaryPath: path.join(SERVICES_DIR, "rust-bmatch-engine", "target", "release", "bmatch-engine"),
  },
  {
    // Go: BDC FX transfer connector — routes BDC partner FX to ADB per CBN circular
    name: "go-bdc-connector",
    dir: path.join(SERVICES_DIR, "go-bdc-connector"),
    command: "/usr/local/go/bin/go",
    args: ["run", "main.go"],
    env: { PORT: "8087", GIN_MODE: "release" },
    port: 8087,
  },
];

const processes: Map<string, ChildProcess> = new Map();
let shuttingDown = false;

function spawnService(config: ServiceConfig): void {
  // Use pre-built binary if it exists (faster startup)
  let command = config.command;
  let args = config.args;

  if (config.binaryPath && fs.existsSync(config.binaryPath)) {
    command = config.binaryPath;
    args = [];
  }

  // Check if command exists
  if (!fs.existsSync(command) && !command.includes(" ")) {
    // Try to find in PATH — if not found, skip gracefully
    try {
      execSync(`which ${command}`, { stdio: "ignore" });
    } catch {
      logger.warn(
        `[Microservices] Skipping ${config.name}: command '${command}' not found`
      );
      return;
    }
  }

  if (!fs.existsSync(config.dir)) {
    logger.warn(
      `[Microservices] Skipping ${config.name}: directory not found at ${config.dir}`
    );
    return;
  }

  logger.info(
    `[Microservices] Starting ${config.name} on port ${config.port}...`
  );

  const child = spawn(command, args, {
    cwd: config.dir,
    env: { ...process.env, ...config.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  processes.set(config.name, child);

  child.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    lines.forEach((line) => {
      if (line.trim()) {
        logger.info(`[${config.name}] ${line}`);
      }
    });
  });

  child.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    lines.forEach((line) => {
      if (line.trim()) {
        // Rust/Go log to stderr by default — not necessarily errors
        logger.info(`[${config.name}] ${line}`);
      }
    });
  });

  child.on("exit", (code, signal) => {
    processes.delete(config.name);
    if (!shuttingDown) {
      if (code !== 0 && code !== null) {
        logger.warn(
          `[Microservices] ${config.name} exited with code ${code}. Restarting in 5s...`
        );
        setTimeout(() => spawnService(config), 5000);
      } else if (signal) {
        logger.info(`[Microservices] ${config.name} killed by signal ${signal}`);
      }
    }
  });

  child.on("error", (err) => {
    logger.warn(
      `[Microservices] Failed to start ${config.name}: ${err.message}`
    );
    processes.delete(config.name);
  });
}

export function startMicroservices(): void {
  // Only auto-start in development
  if (process.env.NODE_ENV === "production") {
    logger.info(
      "[Microservices] Production mode — microservices managed by Docker Compose"
    );
    return;
  }

  logger.info("[Microservices] Starting polyglot microservices...");
  SERVICES.forEach(spawnService);

  // Graceful shutdown
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("[Microservices] Shutting down child processes...");
    processes.forEach((child, name) => {
      logger.info(`[Microservices] Stopping ${name}...`);
      child.kill("SIGTERM");
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("exit", shutdown);
}

export function getMicroserviceStatus(): Record<
  string,
  { running: boolean; pid?: number; port: number }
> {
  return Object.fromEntries(
    SERVICES.map((s) => {
      const child = processes.get(s.name);
      return [
        s.name,
        {
          running: !!child && !child.killed,
          pid: child?.pid,
          port: s.port,
        },
      ];
    })
  );
}

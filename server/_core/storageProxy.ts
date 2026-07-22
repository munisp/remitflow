/**
 * Static Asset Storage Proxy
 *
 * Serves app icons and other static assets from S3-compatible object storage.
 * Configure via environment variables:
 *   STORAGE_ENDPOINT  — S3-compatible endpoint (e.g. https://s3.amazonaws.com)
 *   STORAGE_BUCKET    — Bucket name
 *   STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY — AWS-style credentials (optional for public buckets)
 *
 * Route: GET /icons/* → proxied from STORAGE_ENDPOINT/STORAGE_BUCKET/icons/*
 *
 * Falls back to serving from the local `client/public/icons/` directory if storage
 * is not configured (useful for local development).
 */
import type { Express } from "express";
import path from "node:path";
import fs from "node:fs";
import { logger } from "./logger";

const STORAGE_ENDPOINT = process.env.STORAGE_ENDPOINT ?? "";
const STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? "";

export function registerStorageProxy(app: Express) {
  app.get("/icons/*", async (req, res) => {
    const params = req.params as unknown as Record<string, string | undefined>;
    const key = params["0"];
    if (!key) {
      res.status(400).send("Missing asset key");
      return;
    }

    // If S3-compatible storage is configured, proxy to it
    if (STORAGE_ENDPOINT && STORAGE_BUCKET) {
      try {
        const assetUrl = `${STORAGE_ENDPOINT.replace(/\/+$/, "")}/${STORAGE_BUCKET}/icons/${key}`;
        const upstream = await fetch(assetUrl);
        if (!upstream.ok) {
          logger.warn({ status: upstream.status, key }, "[StorageProxy] upstream error, falling back to local");
        } else {
          const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
          const cacheControl = upstream.headers.get("cache-control") ?? "public, max-age=604800";
          res.set("Content-Type", contentType);
          res.set("Cache-Control", cacheControl);
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.send(buf);
          return;
        }
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[StorageProxy] fetch failed, falling back to local");
      }
    }

    // Fallback: serve from local client/public/icons/
    const localPath = path.resolve(process.cwd(), "client", "public", "icons", key);
    if (fs.existsSync(localPath)) {
      res.set("Cache-Control", "public, max-age=604800");
      res.sendFile(localPath);
    } else {
      res.status(404).send("Asset not found");
    }
  });
}

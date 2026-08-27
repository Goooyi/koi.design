import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";

import type { StaticHandler } from "./app.js";

const DEFAULT_MAX_STATIC_BYTES = 32 * 1024 * 1024;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")
  );
}

function isWithinRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

async function resolveFile(root: string, pathname: string): Promise<string | undefined> {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decodedPath.includes("\0")) {
    return undefined;
  }

  const unresolved = resolve(root, `.${decodedPath}`);
  if (!isWithinRoot(root, unresolved)) {
    return undefined;
  }

  try {
    const metadata = await stat(unresolved);
    const candidate = metadata.isDirectory() ? resolve(unresolved, "index.html") : unresolved;
    const canonical = await realpath(candidate);
    if (!isWithinRoot(root, canonical) || !(await stat(canonical)).isFile()) {
      return undefined;
    }
    return canonical;
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function createStaticHandler(
  rootDirectory: string,
  maxStaticBytes = DEFAULT_MAX_STATIC_BYTES,
): Promise<StaticHandler> {
  if (!Number.isSafeInteger(maxStaticBytes) || maxStaticBytes <= 0) {
    throw new TypeError("maxStaticBytes must be a positive integer");
  }
  const root = await realpath(resolve(rootDirectory));
  const rootMetadata = await stat(root);
  if (!rootMetadata.isDirectory()) {
    throw new TypeError("Static root must be a directory");
  }

  return async (request) => {
    const url = new URL(request.url);
    let file = await resolveFile(root, url.pathname);
    if (!file && request.headers.get("accept")?.includes("text/html")) {
      file = await resolveFile(root, "/index.html");
    }
    if (!file) {
      return undefined;
    }

    const metadata = await stat(file);
    if (metadata.size > maxStaticBytes) {
      return new Response("Static asset exceeds the configured limit", { status: 413 });
    }

    const headers = new Headers({
      "Cache-Control": "no-cache",
      "Content-Length": String(metadata.size),
      "Content-Type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    });
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }

    const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
    return new Response(body, { status: 200, headers });
  };
}

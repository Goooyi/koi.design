import { serve } from "@hono/node-server";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";

import { createKoiApp } from "./app.js";
import { FileKoiRepository } from "./repository.js";
import { configureKoiHttpServer } from "./server-config.js";
import { createStaticHandler } from "./static.js";

function requiredToken(): string {
  const token = process.env.KOI_AUTH_TOKEN;
  if (!token || Buffer.byteLength(token, "utf8") < 32) {
    throw new Error("KOI_AUTH_TOKEN is required; generate a random token with at least 32 bytes");
  }
  return token;
}

function configuredPort(): number {
  const source = process.env.PORT ?? "8787";
  if (!/^\d+$/.test(source)) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const port = Number(source);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

async function main(): Promise<void> {
  const authToken = requiredToken();
  const hostname = process.env.HOST ?? "127.0.0.1";
  const port = configuredPort();
  const repository = new FileKoiRepository(resolve(process.env.KOI_DATA_DIR ?? ".koi/server"));
  await repository.initialize();

  const staticHandler = process.env.KOI_STATIC_DIR
    ? await createStaticHandler(process.env.KOI_STATIC_DIR)
    : undefined;
  const app = createKoiApp({
    repository,
    authToken,
    ...(process.env.KOI_PUBLIC_ORIGIN ? { publicOrigin: process.env.KOI_PUBLIC_ORIGIN } : {}),
    ...(staticHandler ? { staticHandler } : {}),
  });

  // The adapter's return type is a protocol union even when its HTTP factory is explicit.
  const server = serve({ fetch: app.fetch, hostname, port, createServer }, (info) => {
    console.log(`Koi server listening on http://${info.address}:${info.port}`);
  }) as Server;
  configureKoiHttpServer(server);

  let closing = false;
  const close = (signal: NodeJS.Signals) => {
    if (closing) {
      return;
    }
    closing = true;
    console.log(`Received ${signal}; stopping Koi server`);
    const forceClose = setTimeout(() => server.closeAllConnections(), 10_000);
    forceClose.unref();
    server.close((error) => {
      clearTimeout(forceClose);
      if (error) {
        console.error("Koi server failed to stop cleanly", error);
        process.exitCode = 1;
      }
    });
  };
  process.once("SIGINT", () => close("SIGINT"));
  process.once("SIGTERM", () => close("SIGTERM"));
}

await main();

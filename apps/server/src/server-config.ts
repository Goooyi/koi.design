import type { Server } from "node:http";

const DEFAULT_SOCKET_INACTIVITY_TIMEOUT_MS = 30_000;

export interface KoiHttpServerOptions {
  socketInactivityTimeoutMs?: number;
}

export function configureKoiHttpServer(server: Server, options: KoiHttpServerOptions = {}): void {
  const socketInactivityTimeoutMs =
    options.socketInactivityTimeoutMs ?? DEFAULT_SOCKET_INACTIVITY_TIMEOUT_MS;
  if (!Number.isSafeInteger(socketInactivityTimeoutMs) || socketInactivityTimeoutMs <= 0) {
    throw new TypeError("socketInactivityTimeoutMs must be a positive integer");
  }

  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1;
  server.maxConnections = 8;
  server.maxHeadersCount = 100;
  server.setTimeout(socketInactivityTimeoutMs, (socket) => socket.destroy());
}

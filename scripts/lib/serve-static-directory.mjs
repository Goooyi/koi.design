import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const mediaTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

function resolvePublicPath(root, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl ?? "/", "http://127.0.0.1").pathname);
  } catch {
    return null;
  }
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const candidate = path.resolve(root, relativePath);
  return candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

export async function serveStaticDirectory(root, { responseHeaders = {} } = {}) {
  const resolvedRoot = path.resolve(root);
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
      return;
    }
    const candidate = resolvePublicPath(resolvedRoot, request.url);
    if (!candidate) {
      response.writeHead(400).end("Invalid path");
      return;
    }
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) throw Object.assign(new Error("Not a file"), { code: "ENOENT" });
      const content = await fs.readFile(candidate);
      response.writeHead(200, {
        ...responseHeaders,
        "Cache-Control": "no-store",
        "Content-Length": String(content.byteLength),
        "Content-Type": mediaTypes.get(path.extname(candidate)) ?? "application/octet-stream",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500).end("Static file unavailable");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not resolve static server");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

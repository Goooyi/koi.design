import { InvalidJsonError, PayloadTooLargeError, UnsupportedMediaTypeError } from "./errors.js";

export async function readLimitedJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new UnsupportedMediaTypeError();
  }

  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    throw new UnsupportedMediaTypeError();
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    if (!/^\d+$/.test(contentLength)) {
      throw new InvalidJsonError("Content-Length must be a non-negative integer");
    }
    if (Number(contentLength) > maxBytes) {
      throw new PayloadTooLargeError();
    }
  }

  if (!request.body) {
    throw new InvalidJsonError();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(Buffer.concat(chunks, byteLength).toString("utf8")) as unknown;
  } catch (error) {
    throw new InvalidJsonError(error instanceof SyntaxError ? error.message : undefined);
  }
}

export interface StaticDirectoryServer {
  url: string;
  close: () => Promise<void>;
}

export function serveStaticDirectory(
  root: string,
  options?: { responseHeaders?: Readonly<Record<string, string>> },
): Promise<StaticDirectoryServer>;

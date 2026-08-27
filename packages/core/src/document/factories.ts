import {
  KOI_ASTRYX_PROFILE_VERSION,
  KOI_SCHEMA_VERSION,
  documentSchema,
  workspaceSchema,
  type Document,
  type Workspace,
} from "./schema.js";

export interface EmptyDocumentOptions {
  id: string;
  workspaceId: string;
  name: string;
  pageId: string;
  pageName?: string;
  historyId: string;
  designProfileVersion: typeof KOI_ASTRYX_PROFILE_VERSION;
}

export function createEmptyDocument(options: EmptyDocumentOptions): Document {
  return documentSchema.parse({
    schemaVersion: KOI_SCHEMA_VERSION,
    id: options.id,
    workspaceId: options.workspaceId,
    name: options.name,
    revision: 0,
    historyId: options.historyId,
    pages: [
      {
        schemaVersion: KOI_SCHEMA_VERSION,
        id: options.pageId,
        name: options.pageName ?? "Page 1",
        elements: [],
      },
    ],
    assets: [],
    designProfile: {
      id: "koi.astryx",
      version: options.designProfileVersion,
      tokens: {},
    },
  });
}

export interface EmptyWorkspaceOptions {
  id: string;
  name: string;
}

export function createEmptyWorkspace(options: EmptyWorkspaceOptions): Workspace {
  return workspaceSchema.parse({
    schemaVersion: KOI_SCHEMA_VERSION,
    id: options.id,
    name: options.name,
    documents: [],
  });
}

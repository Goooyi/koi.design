import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { z } from "zod";

import { projectionSchema, type Projection } from "@koi/core";

export const documentAuthoritySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("local") }),
  z.strictObject({ kind: z.literal("hosted"), baseUrl: z.string().min(1).max(2_048) }),
]);

export type DocumentAuthority = z.infer<typeof documentAuthoritySchema>;

export interface StoredKoiDocument {
  projection: Projection;
  authority: DocumentAuthority;
}

const storedKoiDocumentSchema = z.strictObject({
  projection: projectionSchema,
  authority: documentAuthoritySchema,
});

interface KoiDatabase extends DBSchema {
  metadata: {
    key: "active-document";
    value: string;
  };
  documents: {
    key: string;
    value: StoredKoiDocument;
  };
}

export class IndexedDbProjectionRepository {
  #database: Promise<IDBPDatabase<KoiDatabase>>;

  constructor(databaseName = "koi-design-v2") {
    this.#database = openDB<KoiDatabase>(databaseName, 1, {
      upgrade(database) {
        database.createObjectStore("metadata");
        database.createObjectStore("documents");
      },
    });
  }

  async load(documentId: string): Promise<StoredKoiDocument | undefined> {
    const value = await (await this.#database).get("documents", documentId);
    return value === undefined ? undefined : storedKoiDocumentSchema.parse(value);
  }

  async loadActive(): Promise<StoredKoiDocument | undefined> {
    const database = await this.#database;
    const documentId = await database.get("metadata", "active-document");
    return documentId ? this.load(documentId) : undefined;
  }

  /** Persists recovery progress without making an inactive hosted target the active canvas. */
  async checkpoint(state: StoredKoiDocument): Promise<void> {
    const parsed = storedKoiDocumentSchema.parse(state);
    await (await this.#database).put("documents", parsed, parsed.projection.document.id);
  }

  async save(state: StoredKoiDocument): Promise<void> {
    const parsed = storedKoiDocumentSchema.parse(state);
    const database = await this.#database;
    const transaction = database.transaction(["metadata", "documents"], "readwrite");
    await Promise.all([
      transaction.objectStore("documents").put(parsed, parsed.projection.document.id),
      transaction.objectStore("metadata").put(parsed.projection.document.id, "active-document"),
      transaction.done,
    ]);
  }
}

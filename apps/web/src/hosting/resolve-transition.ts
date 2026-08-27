import { exportDocument, type Projection } from "@koi/core";

import type {
  DocumentAuthority,
  StoredKoiDocument,
} from "../persistence/indexeddb/projection-repository.js";
import { recoverHostedOutbox, type HostedOutboxTarget } from "./recover-outbox.js";

type HostedAuthority = Extract<DocumentAuthority, { kind: "hosted" }>;

interface ResolveHostedTransitionTargetOptions {
  mode: "open" | "publish";
  client: HostedOutboxTarget;
  source: StoredKoiDocument;
  hostedAuthority: HostedAuthority;
  remoteProjection: Projection;
  storedTarget: StoredKoiDocument | undefined;
  acceptActiveSourceAsAuthoritative?: boolean;
  checkpoint: (state: StoredKoiDocument) => Promise<void>;
}

export interface ResolvedHostedTransitionTarget {
  projection: Projection;
  recovered: boolean;
}

function hasPendingOutbox(projection: Projection): boolean {
  return projection.outbox.some((entry) => entry.status !== "acknowledged");
}

function hasSameAuthority(left: DocumentAuthority, right: DocumentAuthority): boolean {
  return left.kind === "local"
    ? right.kind === "local"
    : right.kind === "hosted" && left.baseUrl === right.baseUrl;
}

export async function resolveHostedTransitionTarget({
  mode,
  client,
  source,
  hostedAuthority,
  remoteProjection,
  storedTarget,
  acceptActiveSourceAsAuthoritative = false,
  checkpoint,
}: ResolveHostedTransitionTargetOptions): Promise<ResolvedHostedTransitionTarget> {
  if (!storedTarget) return { projection: remoteProjection, recovered: false };

  const pendingOutbox = hasPendingOutbox(storedTarget.projection);
  const belongsToDestination = hasSameAuthority(storedTarget.authority, hostedAuthority);
  if (belongsToDestination && pendingOutbox) {
    const projection = await recoverHostedOutbox(
      client,
      storedTarget.projection,
      (recoveredProjection) =>
        checkpoint({ projection: recoveredProjection, authority: hostedAuthority }),
    );
    return { projection, recovered: true };
  }

  if (belongsToDestination) return { projection: remoteProjection, recovered: false };

  const isActiveSource =
    storedTarget.projection.document.id === source.projection.document.id &&
    hasSameAuthority(storedTarget.authority, source.authority);
  if (!isActiveSource && storedTarget.authority.kind === "local") {
    throw new Error(
      "A saved local canvas uses the same document ID. Opening or publishing this hosted canvas would make that local return target unreachable. Return to the local canvas and export or publish it first.",
    );
  }
  if (!isActiveSource && mode === "publish") {
    throw new Error(
      "A canvas from another host uses the same document ID. Publishing here would overwrite its saved browser state. Open that canvas and export it first.",
    );
  }

  const hasDivergentDocument =
    exportDocument(storedTarget.projection.document) !== exportDocument(remoteProjection.document);
  if (
    mode === "open" &&
    (pendingOutbox || hasDivergentDocument) &&
    !(isActiveSource && acceptActiveSourceAsAuthoritative)
  ) {
    throw new Error(
      "This browser already stores a canvas with the same document ID and changes that opening this hosted copy would hide. Publish or export that canvas first.",
    );
  }

  return { projection: remoteProjection, recovered: false };
}

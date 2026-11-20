import Dexie, { type Table } from 'dexie';
import type { CaseView, DraftAnswers } from '../api/types';

/**
 * IndexedDB schema — docs/11 §5.2. Three tables, exactly as specified.
 *
 * `blobRef` on an outbox row is the row's own id; the compressed image bytes are
 * stored inline on the same row (`blob`) so a queued photo survives a reload
 * without a second table.
 */

export interface DraftRow {
  localId: string;
  serverCaseId: string | null;
  citizenId: string | null;
  programId: string | null;
  wizardStep: string;
  answers: DraftAnswers;
  updatedAt: number;
  /** Set once the server has acknowledged this exact revision. */
  syncedAt: number | null;
}

export type OutboxStatus = 'PENDING' | 'SYNCING' | 'FAILED';

export interface OutboxRow {
  /** UUID — doubles as the `Idempotency-Key` header on replay. */
  id: string;
  createdAt: number;
  citizenId: string | null;
  actForCitizenId: string | null;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body: unknown;
  blobRef: string | null;
  blob: Blob | null;
  /** multipart field name for the blob (e.g. `file`). */
  blobField: string | null;
  /** Extra multipart text fields (doc_type, case_id). */
  formFields: Record<string, string> | null;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  lastErrorCode: string | null;
  nextAttemptAt: number;
  /** Human label shown in the "needs attention" card. */
  label: string;
}

export interface CachedCaseRow {
  id: string;
  citizenId: string | null;
  data: CaseView;
  etag: string | null;
  fetchedAt: number;
}

class HaqdaarDb extends Dexie {
  drafts!: Table<DraftRow, string>;
  outbox!: Table<OutboxRow, string>;
  cachedCases!: Table<CachedCaseRow, string>;

  constructor() {
    super('haqdaar');
    this.version(1).stores({
      drafts: 'localId, serverCaseId, citizenId, updatedAt',
      outbox: 'id, createdAt, status, nextAttemptAt',
      cachedCases: 'id, citizenId, fetchedAt',
    });
  }
}

export const db = new HaqdaarDb();

/** Draft key: one draft per (citizen, program) so a helper never mixes families. */
export function draftKey(citizenId: string | null, programId: string | null): string {
  return `${citizenId ?? 'anon'}::${programId ?? 'default'}`;
}

export async function saveDraft(row: DraftRow): Promise<void> {
  await db.drafts.put(row);
}

export async function loadDraft(citizenId: string | null, programId: string | null): Promise<DraftRow | undefined> {
  return db.drafts.get(draftKey(citizenId, programId));
}

export async function clearDraft(citizenId: string | null, programId: string | null): Promise<void> {
  await db.drafts.delete(draftKey(citizenId, programId));
}

export async function cacheCase(row: CachedCaseRow): Promise<void> {
  await db.cachedCases.put(row);
}

export async function readCachedCase(id: string): Promise<CachedCaseRow | undefined> {
  return db.cachedCases.get(id);
}

/** Helper Mode safety: wipe every trace of the previous family from this device. */
export async function wipeCitizenLocalData(citizenId: string | null): Promise<void> {
  if (!citizenId) return;
  await db.drafts.where('citizenId').equals(citizenId).delete();
  await db.cachedCases.where('citizenId').equals(citizenId).delete();
}

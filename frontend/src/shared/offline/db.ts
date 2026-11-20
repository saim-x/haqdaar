import Dexie, { type Table } from 'dexie';
import type { DraftAnswers } from '../api/types';

// IndexedDB schema (docs/11 §5.2).

export interface DraftRow {
  localId: string;
  serverCaseId: string | null;
  citizenId: string;
  programId: string;
  wizardStep: string;
  answers: DraftAnswers;
  /** Local document state so a photo taken offline survives a reload. */
  docs: Record<string, { status: string; localBlobKey?: string; serverId?: string; retakeUr?: string | null; retakeEn?: string | null }>;
  consentGranted: boolean;
  submittedLocally: boolean;
  updatedAt: number;
}

export type OutboxStatus = 'PENDING' | 'SYNCING' | 'FAILED';

export interface OutboxRow {
  /** UUID, also sent as the Idempotency-Key header. */
  id: string;
  createdAt: number;
  citizenId: string;
  actForCitizenId: string | null;
  kind: 'CREATE_CASE' | 'SAVE_DRAFT' | 'SUBMIT' | 'UPLOAD_DOC' | 'COMPLAINT' | 'GRANT_CONSENT';
  method: 'POST' | 'PATCH';
  /** May contain `{case:<localId>}` which is resolved to the server id at send time. */
  path: string;
  body?: unknown;
  blob?: Blob;
  form?: Record<string, string>;
  /** Draft that this operation belongs to (for id mapping). */
  localCaseId?: string;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  lastErrorUr?: string;
}

export interface CachedCaseRow {
  id: string;
  citizenId: string;
  data: unknown;
  etag?: string;
  fetchedAt: number;
}

class HaqdaarDB extends Dexie {
  drafts!: Table<DraftRow, string>;
  outbox!: Table<OutboxRow, string>;
  cachedCases!: Table<CachedCaseRow, string>;
  blobs!: Table<{ key: string; blob: Blob }, string>;

  constructor() {
    super('haqdaar');
    this.version(1).stores({
      drafts: 'localId, serverCaseId, citizenId, updatedAt',
      outbox: 'id, createdAt, status, citizenId, localCaseId',
      cachedCases: 'id, citizenId, fetchedAt',
      blobs: 'key',
    });
  }
}

export const db = new HaqdaarDB();

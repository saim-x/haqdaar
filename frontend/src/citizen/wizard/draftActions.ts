import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { uuid } from '../../shared/api/client';
import type { CaseDetail, ConsentGrant, DataCategory, DocType, DocumentUploadResponse, DraftAnswer, Program } from '../../shared/api/types';
import { authStore } from '../../shared/auth/store';
import { db, type DraftRow } from '../../shared/offline/db';
import { sendOrQueue, type SendOutcome } from '../../shared/offline/outbox';

// All wizard writes go through IndexedDB first and then the outbox, so closing
// the app or losing signal never loses an answer (AC-03.2, AC-24.2).

function ctx() {
  const s = authStore.get();
  const actFor = s.user?.role === 'HELPER' ? s.actingFor?.citizenId ?? null : null;
  return { citizenId: actFor ?? s.citizenId ?? 'self', actForCitizenId: actFor, enteredBy: (actFor ? 'HELPER' : 'CITIZEN') as 'HELPER' | 'CITIZEN' };
}

export function useDraft(localId: string | undefined): DraftRow | null | undefined {
  const [row, setRow] = useState<DraftRow | null | undefined>(undefined);
  useEffect(() => {
    if (!localId) return;
    const sub = liveQuery(() => db.drafts.get(localId)).subscribe({ next: (r) => setRow(r ?? null) });
    return () => sub.unsubscribe();
  }, [localId]);
  return row;
}

export async function createLocalDraft(program: Program, serverCase?: CaseDetail): Promise<string> {
  const { citizenId } = ctx();
  const localId = uuid();
  const row: DraftRow = {
    localId,
    serverCaseId: serverCase?.id ?? null,
    citizenId,
    programId: program.id,
    wizardStep: serverCase?.wizard_step ?? 'consent',
    answers: serverCase?.draft_answers ?? {},
    docs: Object.fromEntries(
      (serverCase?.documents ?? []).map((d) => [d.doc_type, { status: d.verify_status, serverId: d.id, retakeUr: d.retake_reason_ur, retakeEn: d.retake_reason_en }]),
    ),
    consentGranted: !!serverCase,
    submittedLocally: false,
    updatedAt: Date.now(),
  };
  await db.drafts.put(row);
  return localId;
}

const ALL_CATEGORIES: DataCategory[] = ['IDENTITY', 'HOUSEHOLD', 'DOCUMENTS', 'PAYMENT', 'CASE_HISTORY'];

/** Consent gate → grant department consent, then create the server case. */
export async function grantConsentAndCreateCase(draft: DraftRow, program: Program, nextStep: string): Promise<void> {
  const c = ctx();
  const grant = await sendOrQueue<ConsentGrant>({
    kind: 'GRANT_CONSENT',
    method: 'POST',
    path: '/consent/grants',
    body: {
      recipient_type: 'DEPARTMENT',
      recipient_tenant_id: program.tenant_id ?? null,
      categories: ALL_CATEGORIES,
      purposes: ['BENEFIT_APPLICATION', 'PAYMENT_DISBURSEMENT'],
      assurance_level: c.actForCitizenId ? 'CITIZEN_OTP' : 'SELF_OTP',
    },
    citizenId: c.citizenId,
    actForCitizenId: c.actForCitizenId,
  });
  if (grant.status === 'failed' && grant.error.status !== 409) throw grant.error;
  if (!draft.serverCaseId) {
    const created = await sendOrQueue<CaseDetail>({
      kind: 'CREATE_CASE',
      method: 'POST',
      path: '/cases',
      body: { program_id: program.id, case_type: 'BENEFIT_APPLICATION' },
      citizenId: c.citizenId,
      actForCitizenId: c.actForCitizenId,
      localCaseId: draft.localId,
    });
    if (created.status === 'failed') throw created.error;
  }
  // One write: mark consent and advance together, so a fast answer on the next
  // screen can never be overwritten by a late step change.
  await db.drafts.update(draft.localId, { consentGranted: true, wizardStep: nextStep, updatedAt: Date.now() });
}

export async function saveAnswer(localId: string, key: string, answer: Omit<DraftAnswer, 'entered_by'>, nextStep: string) {
  const c = ctx();
  const draft = await db.drafts.get(localId);
  if (!draft) return;
  const full: DraftAnswer = { ...answer, entered_by: c.enteredBy };
  const answers = { ...draft.answers, [key]: full };
  await db.drafts.update(localId, { answers, wizardStep: nextStep, updatedAt: Date.now() });
  // Fire-and-forget: the outbox guarantees delivery and ordering.
  void sendOrQueue(
    {
      kind: 'SAVE_DRAFT',
      method: 'PATCH',
      path: `/cases/{case:${localId}}/draft`,
      body: { wizard_step: nextStep, answers: { [key]: full } },
      citizenId: c.citizenId,
      actForCitizenId: c.actForCitizenId,
      localCaseId: localId,
    },
    1,
  );
}

export async function setStep(localId: string, step: string) {
  await db.drafts.update(localId, { wizardStep: step, updatedAt: Date.now() });
}

export async function uploadDocument(localId: string, docType: DocType, blob: Blob): Promise<SendOutcome<DocumentUploadResponse>> {
  const c = ctx();
  const blobKey = `${localId}:${docType}`;
  await db.blobs.put({ key: blobKey, blob });
  const draft = await db.drafts.get(localId);
  if (draft) {
    await db.drafts.update(localId, {
      docs: { ...draft.docs, [docType]: { status: 'PENDING', localBlobKey: blobKey } },
      updatedAt: Date.now(),
    });
  }
  const out = await sendOrQueue<DocumentUploadResponse>(
    {
      kind: 'UPLOAD_DOC',
      method: 'POST',
      path: '/documents',
      blob,
      form: { doc_type: docType, case_id: `{case:${localId}}` },
      citizenId: c.citizenId,
      actForCitizenId: c.actForCitizenId,
      localCaseId: localId,
    },
    20000,
  );
  const fresh = await db.drafts.get(localId);
  if (fresh) {
    const status = out.status === 'sent' ? out.data.verify_status : out.status === 'queued' ? 'QUEUED' : 'ERROR';
    await db.drafts.update(localId, {
      docs: {
        ...fresh.docs,
        [docType]: {
          status,
          localBlobKey: blobKey,
          serverId: out.status === 'sent' ? out.data.id : undefined,
          retakeUr: out.status === 'sent' ? out.data.retake_reason_ur : null,
          retakeEn: out.status === 'sent' ? out.data.retake_reason_en : null,
        },
      },
    });
  }
  return out;
}

export async function markDocSkipped(localId: string, docType: DocType) {
  const draft = await db.drafts.get(localId);
  if (!draft) return;
  await db.drafts.update(localId, { docs: { ...draft.docs, [docType]: { status: 'SKIPPED' } }, updatedAt: Date.now() });
}

export async function submitDraft(localId: string): Promise<SendOutcome<CaseDetail>> {
  const c = ctx();
  await db.drafts.update(localId, { submittedLocally: true, updatedAt: Date.now() });
  return sendOrQueue<CaseDetail>(
    {
      kind: 'SUBMIT',
      method: 'POST',
      path: `/cases/{case:${localId}}/submit`,
      body: {},
      citizenId: c.citizenId,
      actForCitizenId: c.actForCitizenId,
      localCaseId: localId,
    },
    15000,
  );
}

import type { CaseView, DocumentType } from '../shared/api/types';

export function latestDocument(caseView: CaseView, type: DocumentType) {
  // The case payload lists attempts oldest first and keeps them for review.
  const attempts = caseView.documents.filter((document) => document.doc_type === type);
  return attempts[attempts.length - 1] ?? null;
}

export function documentRetake(caseView: CaseView) {
  if (caseView.case_type === 'COMPLAINT' || !['DRAFT', 'NEEDS_INFO'].includes(caseView.status)) return;
  const identity = latestDocument(caseView, 'CNIC_FRONT');
  if (identity?.verify_status === 'NEEDS_RETAKE') return { document: identity, step: 'cnic_doc' };
  const deathCertificate = latestDocument(caseView, 'SPOUSE_DEATH_CERTIFICATE');
  if (deathCertificate?.verify_status === 'NEEDS_RETAKE') return { document: deathCertificate, step: 'death_cert_doc' };
}

import { request, uuid } from './client';
import type * as T from './types';

// One typed function per endpoint in docs/05-api-contracts.md.
// List endpoints tolerate either a bare array or the pagination envelope, so the
// UI keeps working whichever shape the backend settles on.

export function asList<X>(data: X[] | T.Page<X> | { items: X[] } | null | undefined): X[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.items ?? [];
}

type ListResp<X> = X[] | T.Page<X>;

// ---------- Auth ----------
export const auth = {
  demoLogin: (persona_key: T.PersonaKey) =>
    request<T.TokenPayload>('/auth/demo-login', { method: 'POST', body: { persona_key } }),
  login: (email: string, password: string) =>
    request<T.TokenPayload>('/auth/login', { method: 'POST', body: { email, password } }),
  otpRequest: (phone: string) =>
    request<T.OtpRequestResponse>('/auth/otp/request', { method: 'POST', body: { phone, purpose: 'LOGIN' } }),
  otpVerify: (challenge_id: string, code: string) =>
    request<T.TokenPayload>('/auth/otp/verify', { method: 'POST', body: { challenge_id, code } }),
  me: () => request<T.MeResponse>('/auth/me'),
  logout: (refresh_token: string) =>
    request<{ ok: boolean }>('/auth/logout', { method: 'POST', body: { refresh_token } }),
};

// ---------- Programs & cases ----------
export const programs = {
  list: () => request<ListResp<T.Program>>('/programs').then(asList),
};

export const cases = {
  list: () => request<ListResp<T.CaseSummary>>('/cases').then(asList),
  get: (id: string) => request<T.CaseDetail>(`/cases/${id}`),
  create: (program_id: string, key = uuid(), case_type: T.CaseType = 'BENEFIT_APPLICATION') =>
    request<T.CaseDetail>('/cases', { method: 'POST', body: { program_id, case_type }, idempotencyKey: key }),
  saveDraft: (id: string, wizard_step: string, answers: T.DraftAnswers, key = uuid()) =>
    request<T.CaseDetail>(`/cases/${id}/draft`, {
      method: 'PATCH',
      body: { wizard_step, answers },
      idempotencyKey: key,
    }),
  submit: (id: string, key = uuid()) =>
    request<T.CaseDetail>(`/cases/${id}/submit`, { method: 'POST', body: {}, idempotencyKey: key }),
  withdraw: (id: string) => request<T.CaseDetail>(`/cases/${id}/withdraw`, { method: 'POST', body: {} }),
  complaint: (id: string, reason: string, key = uuid()) =>
    request<T.CaseDetail>(`/cases/${id}/complaint`, { method: 'POST', body: { reason }, idempotencyKey: key }),
};

// ---------- Documents ----------
export const documents = {
  upload: (file: Blob, doc_type: T.DocType, case_id: string | null, key = uuid()) => {
    const form = new FormData();
    form.append('file', file, `${doc_type.toLowerCase()}.jpg`);
    form.append('doc_type', doc_type);
    if (case_id) form.append('case_id', case_id);
    return request<T.DocumentUploadResponse>('/documents', {
      method: 'POST',
      form,
      idempotencyKey: key,
      timeoutMs: 30000,
    });
  },
  get: (id: string) => request<T.CaseDocument>(`/documents/${id}`),
  fileUrl: (id: string) => `/api/v1/documents/${id}/file`,
};

// ---------- Consent & my data ----------
export const consent = {
  grants: () => request<ListResp<T.ConsentGrant>>('/consent/grants').then(asList),
  grant: (body: {
    recipient_type: T.ConsentRecipientType;
    recipient_tenant_id?: string | null;
    recipient_user_id?: string | null;
    categories: T.DataCategory[];
    purposes: T.ConsentPurpose[];
    assurance_level: T.AssuranceLevel;
    otp_challenge_id?: string;
    verbal_audio_id?: string;
  }, key = uuid()) => request<T.ConsentGrant>('/consent/grants', { method: 'POST', body, idempotencyKey: key }),
  modify: (id: string, body: { categories?: T.DataCategory[]; purposes?: T.ConsentPurpose[] }) =>
    request<T.ConsentGrant>(`/consent/grants/${id}`, { method: 'PATCH', body }),
  withdraw: (id: string, confirm_case_hold = false) =>
    request<T.ConsentGrant>(`/consent/grants/${id}/withdraw`, { method: 'POST', body: { confirm_case_hold } }),
  accessLogs: (query: { citizen_id?: string; limit?: number; offset?: number } = {}) =>
    request<ListResp<T.AccessLog>>('/consent/access-logs', { query }).then(asList),
};

export const me = {
  data: () => request<T.MyDataResponse>('/me/data'),
  correct: (field_key: string, requested_value: unknown, reason: string) =>
    request<T.CorrectionRequest>('/me/corrections', { method: 'POST', body: { field_key, requested_value, reason } }),
  notifications: () => request<ListResp<T.Notification>>('/me/notifications').then(asList),
};

// ---------- Helper ----------
export const helper = {
  families: () => request<ListResp<T.Family>>('/helper/families', { actFor: null }).then(asList),
  addFamily: (body: { full_name: string; phone: string; district: string; cnic_digits?: string }) =>
    request<T.Family>('/helper/families', { method: 'POST', body, actFor: null }),
  consentOtp: (citizenId: string) =>
    request<T.OtpRequestResponse>(`/helper/families/${citizenId}/consent-otp`, { method: 'POST', body: {}, actFor: null }),
  consentVerify: (citizenId: string, body: { challenge_id?: string; code?: string; verbal_audio_id?: string; attested?: boolean }) =>
    request<T.ConsentGrant>(`/helper/families/${citizenId}/consent-verify`, { method: 'POST', body, actFor: null }),
};

// ---------- Officer ----------
export const officer = {
  queue: (query: { sort?: string; status?: string; flag?: string; assigned?: string; limit?: number; offset?: number }) =>
    request<T.Page<T.QueueCard> | T.QueueCard[]>('/officer/queue', { query }),
  assign: (id: string) => request<T.CaseDetail>(`/officer/cases/${id}/assign`, { method: 'POST', body: {} }),
  decide: (id: string, body: T.DecideRequest) =>
    request<T.CaseDetail>(`/officer/cases/${id}/decide`, { method: 'POST', body }),
  reevaluate: (id: string) => request<T.CaseDetail>(`/officer/cases/${id}/reevaluate`, { method: 'POST', body: {} }),
  note: (id: string, body: string, is_visible_to_citizen: boolean) =>
    request<T.CaseNote>(`/officer/cases/${id}/notes`, { method: 'POST', body: { body, is_visible_to_citizen } }),
  corrections: () => request<ListResp<T.CorrectionRequest>>('/officer/corrections').then(asList),
  resolveCorrection: (id: string, approve: boolean, note: string) =>
    request<T.CorrectionRequest>(`/officer/corrections/${id}/resolve`, {
      method: 'POST',
      body: { decision: approve ? 'APPROVE' : 'REJECT', note },
    }),
};

// ---------- Admin ----------
export const admin = {
  ruleVersions: (programId: string) =>
    request<ListResp<T.RuleVersion>>(`/admin/programs/${programId}/rules`).then(asList),
  createDraft: (programId: string, rules_json?: T.RuleSet) =>
    request<T.RuleVersion>(`/admin/programs/${programId}/rules`, { method: 'POST', body: rules_json ? { rules_json } : {} }),
  updateDraft: (id: string, rules_json: T.RuleSet) =>
    request<T.RuleVersion>(`/admin/rules/${id}`, { method: 'PUT', body: { rules_json } }),
  validate: (id: string) => request<T.RuleValidationResult>(`/admin/rules/${id}/validate`, { method: 'POST', body: {} }),
  simulate: (id: string, sample_size = 200) =>
    request<T.TwinResult>(`/admin/rules/${id}/simulate`, { method: 'POST', body: { sample_size } }),
  publish: (id: string, change_note: string) =>
    request<T.RuleVersion>(`/admin/rules/${id}/publish`, { method: 'POST', body: { change_note } }),
  users: () => request<ListResp<T.User>>('/admin/users').then(asList),
  createUser: (body: { full_name: string; email: string; role: T.Role; password: string }) =>
    request<T.User>('/admin/users', { method: 'POST', body }),
  updateUser: (id: string, body: { role?: T.Role; is_active?: boolean }) =>
    request<T.User>(`/admin/users/${id}`, { method: 'PATCH', body }),
  apiKeys: () => request<ListResp<T.ApiKey>>('/admin/api-keys').then(asList),
  createApiKey: (body: { name: string; scopes: string[]; rate_limit_per_min: number }) =>
    request<T.ApiKeyCreated>('/admin/api-keys', { method: 'POST', body }),
  revokeApiKey: (id: string) => request<T.ApiKey>(`/admin/api-keys/${id}`, { method: 'DELETE' }),
  mocks: () => request<ListResp<T.MockServiceConfig>>('/admin/mocks').then(asList),
  updateMock: (service_name: string, body: { mode: T.MockMode; latency_ms?: number; failure_rate?: number }) =>
    request<T.MockServiceConfig>('/admin/mocks', { method: 'PATCH', body: { service_name, ...body } }),
  jobs: (status?: string) => request<ListResp<T.Job>>('/admin/jobs', { query: { status } }).then(asList),
  retryJob: (id: string) => request<T.Job>(`/admin/jobs/${id}/retry`, { method: 'POST', body: {} }),
  demoReset: () => request<{ ok: boolean }>('/admin/demo/reset', { method: 'POST', body: {} }),
};

// ---------- Auditor ----------
export const auditor = {
  events: (query: { case_id?: string; actor_type?: string; action?: string; limit?: number; offset?: number }) =>
    request<T.Page<T.AuditEvent> | T.AuditEvent[]>('/auditor/events', { query }),
  trace: (caseId: string) => request<T.CaseTrace>(`/auditor/cases/${caseId}/trace`),
  consents: () =>
    request<{ grants: T.ConsentGrant[]; access_logs: T.AccessLog[] }>('/auditor/consents'),
  verifyChain: () => request<T.ChainVerifyResult>('/auditor/verify-chain'),
};

// ---------- AI ----------
export const ai = {
  transcribeParse: (audio: Blob, field_key: string, lang: 'ur' | 'en' = 'ur') => {
    const form = new FormData();
    form.append('audio', audio, 'answer.webm');
    form.append('field_key', field_key);
    form.append('lang', lang);
    return request<T.VoiceParseResponse>('/voice/transcribe-parse', { method: 'POST', form, timeoutMs: 30000 });
  },
  tts: (text: string, lang: 'ur' | 'en' = 'ur') =>
    request<{ url: string }>('/voice/tts', { method: 'POST', body: { text, lang } }),
  scamCheck: (text: string, district?: string) =>
    request<T.ScamCheckResponse>('/scam/check', { method: 'POST', body: { text, district }, actFor: null }),
  scamCheckImage: (image: Blob) => {
    const form = new FormData();
    form.append('image', image, 'screenshot.jpg');
    return request<T.ScamCheckResponse>('/scam/check', { method: 'POST', form, actFor: null, timeoutMs: 30000 });
  },
  scamCheckAudio: (audio: Blob) => {
    const form = new FormData();
    form.append('audio', audio, 'message.webm');
    return request<T.ScamCheckResponse>('/scam/check', { method: 'POST', form, actFor: null, timeoutMs: 30000 });
  },
  scamFeedback: (checkId: string, note: string) =>
    request<{ ok: boolean }>(`/scam/${checkId}/feedback`, { method: 'POST', body: { disputed: true, note }, actFor: null }),
  ask: (question: string, lang: 'ur' | 'en', program_id: string | null = null) =>
    request<T.RagAnswer>('/rag/ask', { method: 'POST', body: { question, lang, program_id } }),
};

// ---------- Eval, analytics, transparency, device sim ----------
export const insights = {
  eval: () => request<T.EvalDashboard>('/eval/dashboard'),
  analytics: () => request<T.TenantAnalytics>('/analytics/tenant'),
  transparency: () => request<T.TransparencyResponse>('/transparency'),
  smsInbox: (phone: string) =>
    request<T.SmsInbox>(`/mock/v1/sms/inbox/${encodeURIComponent(phone)}`, { raw: true, actFor: null }),
};

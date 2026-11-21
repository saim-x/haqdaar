/** Error codes — docs/05 §2. Never invent a code outside this union. */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'INVALID_OTP'
  | 'FORBIDDEN'
  | 'CONSENT_REVOKED'
  | 'SAME_OFFICER'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RULE_VERSION_IMMUTABLE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RULE_VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export interface ApiErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message_en: string;
    message_ur: string;
    request_id?: string;
    details?: Record<string, unknown>;
  };
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly messageEn: string;
  readonly messageUr: string;
  readonly requestId: string | null;
  readonly details: Record<string, unknown>;

  constructor(init: {
    code: ApiErrorCode;
    status: number;
    messageEn: string;
    messageUr: string;
    requestId?: string | null;
    details?: Record<string, unknown>;
  }) {
    super(init.messageEn);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.messageEn = init.messageEn;
    this.messageUr = init.messageUr;
    this.requestId = init.requestId ?? null;
    this.details = init.details ?? {};
  }

  /** Consent withdrawal is a first-class UI state, not a generic failure. */
  get isConsentRevoked(): boolean {
    return this.code === 'CONSENT_REVOKED';
  }

  get isNotFound(): boolean {
    return this.code === 'NOT_FOUND' || this.status === 404;
  }

  get isOffline(): boolean {
    return this.code === 'NETWORK_ERROR';
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Human-facing message in the active language, with a safe fallback. */
export function errorMessage(err: unknown, lang: 'ur' | 'sd' | 'en'): string {
  if (err instanceof ApiError) {
    return lang === 'en' ? err.messageEn || err.messageUr : err.messageUr || err.messageEn;
  }
  if (err instanceof Error) return err.message;
  if (lang === 'sd') return 'ڪجهه غلط ٿي ويو.';
  return lang === 'ur' ? 'کچھ غلط ہو گیا۔' : 'Something went wrong.';
}

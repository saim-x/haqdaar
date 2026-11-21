import type { CaseView } from '../shared/api/types';
import { useI18n } from '../shared/i18n/I18nProvider';
import { AudioButton } from '../shared/ui/AudioButton';
import { TapLink } from '../shared/ui/TapButton';
import { documentRetake } from './documentAttempts';

export function CaseNextStep({ caseView, fromCache, isHelper }: {
  caseView: CaseView;
  fromCache: boolean;
  isHelper: boolean;
}) {
  const { pick, t } = useI18n();
  const { id, status, citizen_explanation: explanation } = caseView;
  const retake = documentRetake(caseView);
  const wizard = `/c/apply/${id}`;
  let title = pick('اگلا قدم', 'What to do next');
  let ur: string;
  let en: string;
  let action: { to: string; label: string } | undefined;
  let audioKey: string | undefined;

  if (retake) {
    const identity = retake.step === 'cnic_doc';
    title = pick('تصویر دوبارہ لیں', 'Retake a document photo');
    ur = identity ? 'اپنے شناختی کارڈ کے سامنے کی نئی، صاف تصویر لیں۔' : 'وفات کے سرٹیفکیٹ کی نئی، صاف تصویر لیں۔';
    en = identity ? 'Take a new, clear photo of the front of your ID card.' : 'Take a new, clear photo of the death certificate.';
    action = { to: `${wizard}?retake=${retake.step}`, label: title };
  } else if (status === 'NEEDS_INFO') {
    const application = caseView.case_type !== 'COMPLAINT';
    ur = explanation?.next_step_ur || (application
      ? 'اپنی درخواست کھولیں، مانگی گئی معلومات شامل کریں اور دوبارہ جمع کریں۔'
      : 'اگر مزید معلومات مانگی گئی ہیں تو اوپر دی گئی تفصیل دیکھیں۔');
    en = explanation?.next_step_en || (application
      ? 'Open your application, add the requested information and submit it again.'
      : 'Check the explanation for any information requested about your complaint.');
    if (application) action = { to: `${wizard}?resume=request`, label: pick('درخواست کھولیں', 'Open application') };
  } else if (status === 'ON_HOLD_CONSENT') {
    ur = 'معلومات دیکھنے کی اجازت واپس لینے پر درخواست رک گئی ہے۔ اجازتوں کی تفصیل دیکھیں۔';
    en = 'Your case is paused because consent was withdrawn. Check the permissions for this case.';
    if (!isHelper) action = { to: '/c/consent', label: t('consent.title') };
  } else if (status === 'HUMAN_REVIEW' || status === 'IN_REVIEW' || status === 'PENDING_SECOND_APPROVAL') {
    ur = explanation?.next_step_ur || 'ایک افسر آپ کی درخواست دیکھ رہا ہے۔ اگر مزید معلومات چاہییں تو یہاں بتایا جائے گا۔';
    en = explanation?.next_step_en || 'An officer will review this case. Check here for any request for more information.';
  } else if (status === 'WAITING_EXTERNAL') {
    ur = 'درخواست ایک سروس کے جواب کا انتظار کر رہی ہے۔ ابھی آپ کو کچھ کرنے کی ضرورت نہیں۔';
    en = 'Your case is waiting for a service to respond. You do not need to take any action right now.';
    audioKey = 'status_waiting_external';
  } else {
    return null;
  }

  return (
    <section className="card mt-4 border-accent/25 bg-accent-wash p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-body-lg font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-body leading-[1.7] text-ink-2">{pick(ur, en)}</p>
          {retake && <p className="mt-1 text-caption text-ink-2">{pick(retake.document.retake_reason_ur, retake.document.retake_reason_en)}</p>}
          {fromCache && <p className="mt-2 text-meta text-ink-3">{pick('تازہ حالت کے لیے انٹرنیٹ سے جڑیں۔', 'Reconnect to check for an updated next step.')}</p>}
        </div>
        <AudioButton audioKey={audioKey} text={ur} label={pick('اگلا قدم سنیں', 'Listen to the next step')} />
      </div>
      {action && !fromCache && <TapLink to={action.to} size="tap" className="mt-3">{action.label}</TapLink>}
    </section>
  );
}

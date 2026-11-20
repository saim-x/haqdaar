import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Mic, ShieldAlert, Smartphone, Square } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../shared/api/client';
import { helper } from '../shared/api/endpoints';
import type { Family } from '../shared/api/types';
import { useT } from '../shared/i18n';
import { Button } from '../shared/ui/Button';
import { cx } from '../shared/ui/cx';
import { DISTRICTS, isValidPkPhone, normalizePhone } from '../citizen/wizard/steps';

/** Onboard a family + capture consent: citizen OTP (preferred) or witnessed verbal (low assurance). */
export function AddFamily() {
  const { t, pick } = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({ full_name: '', phone: '', district: 'Thatta', cnic_digits: '' });
  const [family, setFamily] = useState<Family | null>(null);
  const [method, setMethod] = useState<'OTP' | 'VERBAL'>('OTP');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [attested, setAttested] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [recording, setRecording] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onErr = (e: unknown) => setError(e instanceof ApiError ? pick(e.messageUr, e.message) : t('somethingWrong'));

  const create = useMutation({
    mutationFn: () =>
      helper.addFamily({
        full_name: form.full_name.trim(),
        phone: normalizePhone(form.phone),
        district: form.district,
        cnic_digits: form.cnic_digits.replace(/\D/g, '') || undefined,
      }),
    onSuccess: (f) => {
      setFamily(f);
      setError(null);
    },
    onError: onErr,
  });
  const sendOtp = useMutation({
    mutationFn: () => helper.consentOtp(family!.citizen_id),
    onSuccess: (r) => setChallenge(r.challenge_id),
    onError: onErr,
  });
  const verify = useMutation({
    mutationFn: () =>
      method === 'OTP'
        ? helper.consentVerify(family!.citizen_id, { challenge_id: challenge!, code })
        : helper.consentVerify(family!.citizen_id, { verbal_audio_id: `verbal-${Date.now()}`, attested: true }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['families'] });
      nav('/h', { replace: true });
    },
    onError: onErr,
  });

  const toggleRecord = async () => {
    if (recording) {
      recRef.current?.stop();
      setRecording(false);
      setRecorded(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      rec.onstop = () => stream.getTracks().forEach((tr) => tr.stop());
      recRef.current = rec;
      rec.start();
      setRecording(true);
      setTimeout(() => {
        if (rec.state === 'recording') {
          rec.stop();
          setRecording(false);
          setRecorded(true);
        }
      }, 10000);
    } catch {
      setError(t('voiceFailed'));
    }
  };

  const field = 'min-h-tap-lg w-full rounded-control border-2 border-input bg-card px-4 text-lg';
  const validProfile = form.full_name.trim().length >= 2 && isValidPkPhone(form.phone);

  return (
    <div className="space-y-5 animate-rise">
      <h1 className="text-3xl font-bold">{t('addFamily')}</h1>
      {error && (
        <p role="alert" className="rounded-control bg-danger-soft p-3 font-medium text-danger">
          {error}
        </p>
      )}

      {!family ? (
        <form
          className="card space-y-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (validProfile) create.mutate();
          }}
        >
          <label className="block">
            <span className="mb-1 block font-semibold">{t('familyName')}</span>
            <input className={field} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
          </label>
          <label className="block">
            <span className="mb-1 block font-semibold">{t('familyPhone')}</span>
            <input className={cx(field, 'num')} dir="ltr" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03XX XXXXXXX" required />
          </label>
          <label className="block">
            <span className="mb-1 block font-semibold">{t('familyDistrict')}</span>
            <select className={field} value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })}>
              {DISTRICTS.map((d) => (
                <option key={d.value} value={d.value}>
                  {pick(d.ur, d.value)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-semibold">{t('familyCnic')}</span>
            <input className={cx(field, 'num')} dir="ltr" inputMode="numeric" value={form.cnic_digits} onChange={(e) => setForm({ ...form, cnic_digits: e.target.value.replace(/[^\d-]/g, '').slice(0, 15) })} />
          </label>
          <Button type="submit" size="lg" block loading={create.isPending} disabled={!validProfile}>
            {t('saveFamily')}
          </Button>
        </form>
      ) : (
        <section className="card space-y-4 p-4">
          <p className="flex items-center gap-2 font-semibold text-ok">
            <CircleCheck className="h-5 w-5" aria-hidden />
            {t('familyAdded')}: {family.full_name}
          </p>
          <h2 className="text-xl font-bold">{t('consentMethod')}</h2>
          <div role="radiogroup" className="grid gap-2">
            {(
              [
                ['OTP', t('consentOtp'), Smartphone],
                ['VERBAL', t('consentVerbal'), Mic],
              ] as const
            ).map(([m, label, Icon]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => setMethod(m)}
                className={cx('flex min-h-tap-lg items-center gap-3 rounded-control border-2 p-3 text-start font-semibold', method === m ? 'border-primary bg-primary-soft' : 'border-border bg-card')}
              >
                <Icon className="h-6 w-6 shrink-0" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          {method === 'OTP' ? (
            <div className="space-y-3">
              {!challenge ? (
                <Button size="lg" block loading={sendOtp.isPending} onClick={() => sendOtp.mutate()}>
                  {t('sendOtp')}
                </Button>
              ) : (
                <>
                  <label className="block">
                    <span className="mb-1 block font-semibold">{t('codeLabel')}</span>
                    <input
                      className={cx(field, 'num text-center text-2xl tracking-[0.5em]')}
                      dir="ltr"
                      inputMode="numeric"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      autoFocus
                    />
                    <span className="mt-1 block text-sm text-muted-foreground">{t('smsHint')}</span>
                  </label>
                  <Button size="lg" block loading={verify.isPending} disabled={code.length !== 6} onClick={() => verify.mutate()}>
                    {t('verifyCode')}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="flex items-start gap-2 rounded-control border-2 border-warn/40 bg-warn-soft p-3 font-semibold text-warn">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                {t('verbalWarning')}
              </p>
              <Button
                size="lg"
                block
                variant={recording ? 'danger' : recorded ? 'secondary' : 'primary'}
                icon={recording ? <Square className="h-6 w-6" aria-hidden /> : recorded ? <CircleCheck className="h-6 w-6" aria-hidden /> : <Mic className="h-6 w-6" aria-hidden />}
                onClick={() => void toggleRecord()}
              >
                {recording ? t('recording') : t('recordConsent')}
              </Button>
              <label className="flex min-h-tap items-start gap-3">
                <input type="checkbox" className="mt-1 h-6 w-6 accent-primary" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                <span className="font-medium">{t('attest')}</span>
              </label>
              <Button size="lg" block loading={verify.isPending} disabled={!attested || !recorded} onClick={() => verify.mutate()}>
                {t('confirm')}
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

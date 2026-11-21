import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Role } from '../api/types';
import { useAudio } from '../audio/AudioProvider';
import { useI18n } from '../i18n/I18nProvider';
import { useLiteMode } from '../lite/LiteModeProvider';
import { AudioButton } from './AudioButton';
import { IconCross } from './Icons';
import { TourQuestion } from './TourQuestion';
import { positionTour, type TourPosition } from './tourPosition';

type Copy = readonly [en: string, ur: string];
export type TourStop = { to: string; anchor?: string; title: Copy; text: Copy; question?: Copy };
type Stops = readonly [TourStop, ...TourStop[]];

export function RoamingTour({ accountId, role, home, pages }: { accountId: string; role: Role; home: string; pages: Stops }) {
  const storageKey = `haqdaar:welcome-tour:v1:${role}:${accountId}`;
  const { pick, lang } = useI18n();
  const { lite } = useLiteMode();
  const { stop } = useAudio();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const route = pathname.replace(/\/$/, '');
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const sessionStepKey = `${storageKey}:active-step`;
  const [step, setStep] = useState<number | null>(() => {
    try {
      const stored = sessionStorage.getItem(sessionStepKey);
      if (stored === null) return null;
      const saved = Number(stored);
      return Number.isInteger(saved) && saved >= 0 && saved < pages.length ? saved : null;
    } catch { return null; }
  });
  const [position, setPosition] = useState<TourPosition | null>(null);
  const [asking, setAsking] = useState(false);
  const [seen, setSeen] = useState(() => {
    try { return localStorage.getItem(storageKey) === 'seen'; } catch { return false; }
  });
  const page = step === null ? null : pages[step] ?? pages[0];

  useEffect(() => {
    if (returnFocus.current && route === home) {
      returnFocus.current = false;
      launcher.current?.focus({ preventScroll: true });
    }
  }, [route, home, step]);

  useEffect(() => {
    if (!page || page.to !== route) return;
    const content = document.getElementById('tour-content');
    const card = panel.current;
    if (!content || !card) return;

    let frame: number;
    let currentTarget: HTMLElement | null = null;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(card);

    function measure() {
      if (!card || !content) return;
      const target = (page?.anchor && content.querySelector<HTMLElement>(`[data-tour="${page.anchor}"]`))
        || content.querySelector<HTMLElement>('h1');
      if (!target) return;
      if (currentTarget !== target) {
        if (currentTarget) resize.unobserve(currentTarget);
        currentTarget = target;
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        resize.observe(target);
      }
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      setPosition(positionTour(rect, card.getBoundingClientRect(), window.innerWidth, window.innerHeight));
    }

    const changes = new MutationObserver(schedule);
    changes.observe(content, { childList: true, subtree: true });
    content.addEventListener('animationend', schedule, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    schedule();
    return () => {
      changes.disconnect();
      resize.disconnect();
      content.removeEventListener('animationend', schedule, true);
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [page, route]);

  const running = step !== null;
  useEffect(() => {
    const modal = dialog.current;
    if (running && modal && !modal.open) {
      try { modal.showModal(); } catch { /* The browser may already be opening the dialog. */ }
    }
  }, [running]);

  useEffect(() => {
    if (!running) return;
    panel.current?.querySelector('button')?.focus({ preventScroll: true });
    return stop;
  }, [running, stop]);

  function markSeen() {
    setSeen(true);
    try { localStorage.setItem(storageKey, 'seen'); } catch { /* Storage may be disabled. */ }
  }

  function go(index: number) {
    const next = pages[index];
    if (!next) return;
    stop();
    setAsking(false);
    setStep(index);
    try { sessionStorage.setItem(sessionStepKey, String(index)); } catch { /* Session storage may be disabled. */ }
    if (route !== next.to) navigate(next.to, { replace: true });
  }

  function finish() {
    const tryCurrentPage = dialog.current?.returnValue === 'try';
    stop();
    setStep(null);
    try { sessionStorage.removeItem(sessionStepKey); } catch { /* Session storage may be disabled. */ }
    setPosition(null);
    markSeen();
    if (tryCurrentPage) {
      const target = page?.anchor && document.querySelector<HTMLElement>(`#tour-content [data-tour="${page.anchor}"]`);
      const controls = 'button, a[href], input, textarea, select';
      if (target) {
        const control = target.matches(controls) ? target : target.querySelector<HTMLElement>(controls);
        control?.focus({ preventScroll: true });
      }
      return;
    }
    returnFocus.current = true;
    if (route !== home) navigate(home, { replace: true });
  }

  const activePosition = route === page?.to ? position : null;
  const focus = activePosition?.focus;
  const pointer = activePosition?.pointer;
  const topic = page ? pick(page.title[1], page.title[0]) : '';
  const starter = page?.question
    ? pick(page.question[1], page.question[0])
    : pick('اس کام کے لیے مجھے کیا کرنا ہے؟', 'What do I need to do here?');

  return (
    <>
      {route === home && (
        <section className="mx-auto w-full max-w-[560px] px-4 pt-3" aria-label={pick('حق دار کا تعارف', 'Haqdaar tour')}>
          <div className={seen ? 'flex justify-end' : 'flex flex-wrap items-center justify-between gap-x-3 rounded-control border border-ink/10 bg-card px-3'}>
            {!seen && (
              <div className="flex items-center gap-2">
                {!lite && (
                  <img src="/icons/haqdaar-tour-guide.webp" width="36" height="36" alt="" className="h-9 w-9 rounded-full bg-accent-wash object-contain" />
                )}
                <p className="text-body font-medium text-ink">{pick('پہلی بار آئے ہیں؟', 'First time here?')}</p>
              </div>
            )}
            <button ref={launcher} type="button" className="press min-h-tap rounded-control px-2 text-caption font-medium text-accent-ink hover:bg-accent-wash"
              onClick={() => {
                if (!dialog.current) return;
                dialog.current.returnValue = '';
                dialog.current.showModal();
                go(0);
              }}>
              {seen ? pick('تعارف دوبارہ دیکھیں', 'Replay tour') : pick('مختصر تعارف دیکھیں', 'Take a quick tour')}
            </button>
            {!seen && (
              <button type="button" className="press min-h-tap rounded-control px-2 text-meta text-ink-3" onClick={() => { markSeen(); launcher.current?.focus(); }}>
                {pick('ابھی نہیں', 'Skip for now')}
              </button>
            )}
          </div>
        </section>
      )}
      <dialog ref={dialog} aria-labelledby={titleId}
        className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 text-ink backdrop:bg-transparent"
        onClose={finish}>
        {page && step !== null && (
          <>
            {focus ? (
              <div aria-hidden="true" data-testid="tour-spotlight"
                className="pointer-events-none fixed left-0 top-0 rounded-[12px] border-2 border-[#71E7C9] shadow-[0_0_0_200vmax_rgba(13,28,26,0.63)] motion-safe:transition-all motion-safe:duration-300"
                style={{ width: focus.width, height: focus.height, transform: `translate(${focus.x}px,${focus.y}px)` }} />
            ) : <div aria-hidden="true" className="fixed inset-0 bg-ink/60" />}
            {pointer && pointer.length >= 8 && (
              <div aria-hidden="true" className="pointer-events-none fixed left-0 top-0 h-3 origin-[0_50%] bg-[#71E7C9] motion-safe:transition-transform motion-safe:duration-300"
                style={{
                  width: pointer.length,
                  clipPath: 'polygon(0 38%, calc(100% - 7px) 38%, calc(100% - 7px) 0, 100% 50%, calc(100% - 7px) 100%, calc(100% - 7px) 62%, 0 62%)',
                  transform: `translate(${pointer.x}px,${pointer.y - 6}px) rotate(${pointer.angle}rad)`,
                }} />
            )}
            <section ref={panel}
              className={`fixed left-0 top-0 z-10 flex w-[min(410px,calc(100%-24px))] flex-col rounded-[20px] border border-accent/30 bg-paper shadow-2xl motion-safe:transition-transform motion-safe:duration-300 ${asking ? 'max-h-[min(60dvh,440px)]' : 'max-h-[calc(100dvh-24px)]'}`}
              style={{ transform: activePosition ? `translate(${activePosition.panel.x}px,${activePosition.panel.y}px)` : 'translate(calc(50vw - 50%), max(12px, calc(50dvh - 50%)))' }}>
              <div className="flex shrink-0 items-center justify-between gap-2 px-3.5 pt-1.5">
                <small className="text-meta font-medium text-accent-ink" aria-live="polite">
                  {pick('مرحلہ', 'Step')} {new Intl.NumberFormat(lang).format(step + 1)} / {new Intl.NumberFormat(lang).format(pages.length)}
                </small>
                <div className="flex flex-wrap items-center justify-end gap-x-1">
                  <button type="button" className="press min-h-tap rounded-control px-2 text-meta font-medium text-accent-ink hover:bg-accent-wash"
                    onClick={() => dialog.current?.close('try')}>{pick('یہاں کام شروع کریں', 'Try this page')}</button>
                  <button type="button" className="press inline-flex min-h-tap items-center gap-1 rounded-control px-2 text-meta text-ink-3 hover:bg-raised"
                    onClick={() => dialog.current?.close()}>
                    <IconCross size={14} /> {pick('تعارف بند کریں', 'Exit tour')}
                  </button>
                </div>
              </div>
              <div className="min-h-0 overflow-y-auto px-3.5 pb-2">
                <div className="flex items-start gap-3">
                  {!lite && (
                    <img src="/icons/haqdaar-tour-pointing.webp" width="84" height="84" alt=""
                      className="h-[84px] w-[84px] shrink-0 rounded-[14px] bg-accent-wash object-contain"
                      style={{ transform: pointer && Math.cos(pointer.angle) < 0 ? 'scaleX(-1)' : undefined }} />
                  )}
                  <div className="min-w-0 flex-1" aria-live="polite" aria-atomic="true">
                    <div className="flex items-center gap-1">
                      <h2 id={titleId} className="min-w-0 flex-1 text-title font-semibold leading-[1.35]">{topic}</h2>
                      <AudioButton text={pick(page.title[1], page.title[0])} label={pick('عنوان سنیں', 'Listen to the title')} variant="quiet" />
                    </div>
                    <div className="flex items-start gap-1">
                      <p className="min-w-0 flex-1 pt-1 text-caption leading-[1.65] text-ink-2">{pick(page.text[1], page.text[0])}</p>
                      <AudioButton text={pick(page.text[1], page.text[0])} label={pick('ہدایات سنیں', 'Listen to the instructions')} variant="quiet" />
                    </div>
                  </div>
                </div>
                {asking && <TourQuestion key={step} topic={topic} starter={starter} />}
              </div>
              <div className="mt-1 flex shrink-0 flex-wrap items-center justify-between gap-x-1 border-t border-ink/10 px-2.5 py-1.5">
                <button type="button" aria-expanded={asking} className="press min-h-tap rounded-control px-2 text-meta font-medium text-accent-ink hover:bg-accent-wash"
                  onClick={() => { stop(); setAsking(!asking); }}>
                  {asking ? pick('مدد بند کریں', 'Close help') : pick('مزید جانیں', 'Know more')}
                </button>
                {step > 0 && <button type="button" className="press min-h-tap rounded-control px-2 text-caption text-ink-2" onClick={() => go(step - 1)}>{pick('پیچھے', 'Back')}</button>}
                <button type="button" className="press ms-auto min-h-tap rounded-control bg-accent px-4 text-body font-medium text-white"
                  onClick={() => step + 1 === pages.length ? dialog.current?.close() : go(step + 1)}>
                  {step + 1 === pages.length ? pick('مکمل', 'Done') : pick('آگے', 'Next')}
                </button>
              </div>
            </section>
          </>
        )}
      </dialog>
    </>
  );
}

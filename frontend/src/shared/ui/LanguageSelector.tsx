import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n, type Lang } from '../i18n/I18nProvider';
import { IconGlobe } from './Icons';

const LANGUAGES: { value: Lang; label: string; english: string }[] = [
  { value: 'ur', label: 'اردو', english: 'Urdu' },
  { value: 'sd', label: 'سنڌي', english: 'Sindhi' },
  { value: 'en', label: 'English', english: 'English' },
];

const MENU_GAP = 6;
const VIEWPORT_PAD = 8;

interface MenuPosition {
  top: number;
  left: number;
}

/** Shows the active language and lets people choose any supported language. */
export function LanguageSelector({ className = '' }: { className?: string }) {
  const { lang, dir, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selected = LANGUAGES.find(({ value }) => value === lang) ?? LANGUAGES[0]!;

  const updatePosition = useCallback(() => {
    const btn = trigger.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      setOpen(false);
      return;
    }
    const menuEl = menu.current;
    const menuWidth = menuEl?.offsetWidth || 176;
    const menuHeight = menuEl?.offsetHeight || 190;
    const maxLeft = Math.max(VIEWPORT_PAD, window.innerWidth - menuWidth - VIEWPORT_PAD);
    const rawLeft = dir === 'rtl' ? rect.left : rect.right - menuWidth;
    const left = Math.min(Math.max(rawLeft, VIEWPORT_PAD), maxLeft);

    const belowTop = rect.bottom + MENU_GAP;
    const fitsBelow = belowTop + menuHeight <= window.innerHeight - VIEWPORT_PAD;
    const aboveTop = rect.top - MENU_GAP - menuHeight;
    const top = fitsBelow || aboveTop < VIEWPORT_PAD
      ? Math.max(VIEWPORT_PAD, Math.min(belowTop, window.innerHeight - menuHeight - VIEWPORT_PAD))
      : aboveTop;

    setPos({ top, left });
  }, [dir]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !menu.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const menuTitle = lang === 'ur' ? 'زبان منتخب کریں' : lang === 'sd' ? 'ٻولي چونڊيو' : 'Choose language';

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Language: ${selected.english}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="lang-toggle"
        className={`press inline-flex min-h-tap items-center gap-2 rounded-control border border-ink/[0.12] bg-card px-2.5 text-meta font-medium text-ink-2 hover:bg-raised hover:text-ink ${className}`}
      >
        <IconGlobe size={15} />
        <span>{selected.label}</span>
        <span aria-hidden="true" className={`text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            dir={dir}
            lang={lang}
            aria-label={menuTitle}
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
            className="fixed z-[100] min-w-44 overflow-hidden rounded-panel border border-ink/[0.12] bg-card p-1.5 shadow-xl"
          >
            <p className="px-2.5 pb-1.5 pt-1 text-meta font-medium text-ink-3">
              {menuTitle}
            </p>
            {LANGUAGES.map(({ value, label, english }) => {
              const isSelected = value === lang;
              return (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  onClick={() => {
                    setLang(value);
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                  className={`press flex min-h-tap w-full items-center justify-between gap-5 rounded-control px-2.5 text-start ${
                    isSelected
                      ? 'bg-accent-wash text-accent-ink'
                      : 'text-ink-2 hover:bg-raised hover:text-ink'
                  }`}
                >
                  <span className="flex flex-col py-1">
                    <span className="text-caption font-medium" lang={value} dir={value === 'en' ? 'ltr' : 'rtl'}>{label}</span>
                    {value !== 'en' && <span className="text-meta text-ink-3">{english}</span>}
                  </span>
                  {isSelected && <span aria-hidden="true" className="text-caption font-semibold">✓</span>}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

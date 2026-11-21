/**
 * The brand.
 *
 * Two static files in `/public/brand`, so neither costs a byte of the 150 KB
 * entry budget and both are precached by the service worker.
 *
 * The mark is language-neutral - a person with an open hand - so it sits next to
 * the localised name. The lockup carries the Latin wordmark and is only used
 * where the surrounding chrome is Latin: the sign-in page and the staff rail.
 * Putting a Latin wordmark inside an Urdu header would be a script mismatch, so
 * the citizen shell uses the mark alone.
 */

export function BrandMark({
  size = 24,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/brand/mark.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={`shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function BrandLockup({
  height = 28,
  alt = 'Haqdaar',
  className = '',
}: {
  height?: number;
  alt?: string;
  className?: string;
}) {
  return (
    <img
      src="/brand/lockup.png"
      alt={alt}
      height={height}
      className={`w-auto select-none ${className}`}
      style={{ height }}
    />
  );
}

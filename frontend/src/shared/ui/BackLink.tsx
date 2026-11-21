import { Link } from 'react-router-dom';
import { IconArrowLeft } from './Icons';

/**
 * The one way this app says "leave this screen".
 *
 * It is a link, not a button, because it navigates. It carries the word as well
 * as the arrow, because an arrow alone on its own row reads as decoration and
 * screen readers announce it as nothing useful. The negative inline start
 * margin pulls the arrow back to the text edge so the label lines up with the
 * heading below it rather than sitting 8px in.
 *
 * `IconArrowLeft` is marked directional, so it mirrors in Urdu on its own.
 */
export function BackLink({
  to,
  label,
  onClick,
}: {
  to: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="press -ms-2 inline-flex min-h-tap items-center gap-1.5 rounded-control px-2 text-caption font-medium text-ink-2 hover:bg-raised hover:text-ink"
    >
      <IconArrowLeft size={16} />
      {label}
    </Link>
  );
}

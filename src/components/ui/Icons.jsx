// Icons.jsx — íconos mínimos para estados. Acompañan al color para que
// ningún estado dependa solo de él (WCAG 1.4.1).
const base = "h-4 w-4 shrink-0";

export function IconError({ className = base }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 6a1 1 0 112 0v4a1 1 0 11-2 0V6zm1 8.25a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5z" clipRule="evenodd" />
    </svg>
  );
}

export function IconWarning({ className = base }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M8.26 3.1a2 2 0 013.48 0l6.02 10.73A2 2 0 0116.02 17H3.98a2 2 0 01-1.74-3.17L8.26 3.1zM10 7a1 1 0 00-1 1v3a1 1 0 102 0V8a1 1 0 00-1-1zm0 8a1.1 1.1 0 100-2.2 1.1 1.1 0 000 2.2z" clipRule="evenodd" />
    </svg>
  );
}

export function IconSuccess({ className = base }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.58 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z" clipRule="evenodd" />
    </svg>
  );
}

export function IconInfo({ className = base }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-9a1 1 0 112 0v5a1 1 0 11-2 0V9zm1-4.25a1.25 1.25 0 110 2.5 1.25 1.25 0 010-2.5z" clipRule="evenodd" />
    </svg>
  );
}

export function IconClose({ className = base }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M5.3 5.3a1 1 0 011.4 0L10 8.6l3.3-3.3a1 1 0 111.4 1.4L11.4 10l3.3 3.3a1 1 0 01-1.4 1.4L10 11.4l-3.3 3.3a1 1 0 01-1.4-1.4L8.6 10 5.3 6.7a1 1 0 010-1.4z" />
    </svg>
  );
}

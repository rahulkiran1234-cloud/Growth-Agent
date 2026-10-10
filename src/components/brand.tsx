// One place for the product name, so renaming is a one-line change.
export const APP_NAME = "Growth Agent";
export const APP_TAGLINE = "Your AI growth analyst";

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true">
      <rect width="96" height="96" rx="22" fill="#2a78d6" />
      <path d="M24 70 L44 48 L54 57 L72 30" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M60 26 L76 24 L74 40 Z" fill="#fff" />
      <circle cx="24" cy="70" r="4.5" fill="#fff" opacity=".6" />
    </svg>
  );
}

/** Only same-site relative paths are allowed as a post-login destination (no open redirects). Browser-safe. */
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\r\n]/.test(raw)) return "/";
  return raw.length > 300 ? "/" : raw;
}

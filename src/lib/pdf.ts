import { existsSync } from "node:fs";

// Server-side PDF export needs an installed Edge or Chrome. Hosts without one (Netlify) use the browser's own "Save as PDF".
export function findBrowser(): string | null {
  const candidates = [
    process.env.PDF_BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

export const pdfAvailable = () => process.env.NETLIFY !== "true" && findBrowser() !== null;

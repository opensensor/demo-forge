/**
 * DemoForge renderer — CSP detection.
 *
 * Detects Content-Security-Policy headers that may block synthetic cursor
 * injection. If CSP is detected, the renderer falls back to real OS cursor
 * recording.
 */

import type { BrowserSession } from '@demoforge/browser';

export interface CSPResult {
  /** Whether CSP headers were detected. */
  hasCSP: boolean;
  /** The CSP header value, if present. */
  policy?: string;
}

/**
 * Check if the current page has Content-Security-Policy headers.
 *
 * @param browser - Browser session to check
 * @returns CSP detection result
 */
export async function detectCSP(browser: BrowserSession): Promise<CSPResult> {
  const page = browser.page;
  if (!page) {
    return { hasCSP: false };
  }

  try {
    // Check if CSP is present via meta tag
    const hasCSPMeta = await page.evaluate(() => {
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      return meta !== null;
    });

    if (hasCSPMeta) {
      const policy = await page.evaluate(() => {
        const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        return meta?.getAttribute('content') || '';
      });
      return { hasCSP: true, policy };
    }

    // Check via CDP for security headers
    try {
      const headers = (page as unknown as { headers: () => Record<string, string> }).headers();
      const cspHeader = headers['content-security-policy'];
      if (cspHeader) {
        return { hasCSP: true, policy: cspHeader };
      }
    } catch {
      // headers() may not be available in all Playwright versions
    }

    return { hasCSP: false };
  } catch {
    // If we can't determine CSP, assume no CSP
    return { hasCSP: false };
  }
}

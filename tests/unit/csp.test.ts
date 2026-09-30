import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Regression guard for a real bug found in the packaged build: the renderer
// is loaded via `file://` in production (main.ts's mainWindow.loadFile), but
// Vite's production build injects the compiled CSS as an external
// `<link rel="stylesheet">` tag. A CSP whose style-src/script-src only allow
// 'self' does not reliably match file:// sub-resources in Chromium/Electron,
// so the stylesheet silently failed to load — the whole app rendered with
// zero custom CSS (default browser styling only), while 'unsafe-inline'
// masked the problem in dev mode (Vite injects dev CSS via inline <style>
// tags, which 'unsafe-inline' does cover). The fix adds the `file:` scheme
// explicitly to every relevant directive. This test fails loudly if that
// regresses, since the visual symptom is easy to miss without a Windows
// packaged build to click through.
describe('renderer CSP allows its own packaged (file://) assets', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '../../src/renderer/index.html'),
    'utf-8'
  );
  const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);

  test('a Content-Security-Policy meta tag is present', () => {
    assert.ok(match, 'index.html must define a CSP meta tag');
  });

  test('style-src and script-src explicitly allow the file: scheme (not just \'self\')', () => {
    const csp = match![1];
    const directive = (name: string) => {
      const m = csp.match(new RegExp(`${name}\\s+([^;]+)`));
      return m ? m[1] : '';
    };
    assert.match(
      directive('style-src'),
      /\bfile:/,
      "style-src must include 'file:' — 'self' alone does not reliably match a file:// <link rel=stylesheet> in a packaged Electron app"
    );
    assert.match(directive('script-src'), /\bfile:/, "script-src must include 'file:' for the packaged build's module script");
    assert.match(directive('img-src'), /\bfile:/, 'img-src must include \'file:\' for locally-stored sponsor/campaign images');
  });
});

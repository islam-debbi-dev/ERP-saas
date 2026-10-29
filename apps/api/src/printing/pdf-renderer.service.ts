import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { type PrintFormat } from '@erp/shared';
import type { Browser, LaunchOptions } from 'puppeteer';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { escapeHtml } from './templates/html';

/**
 * The serverless Chromium ships Open Sans only (Latin): this one prints Arabic names.
 * Same path from src/ and dist/; static, so Vercel's file tracing bundles it.
 */
const ARABIC_FONT = join(__dirname, '..', '..', 'assets', 'fonts', 'NotoNaskhArabic.ttf');

/** Chromium's footer: its own tiny document, styled inline (page CSS does not apply). */
function footerTemplate(footer: string | null): string {
  return `<div style="width:100%;margin:0 10mm;font-family:Arial,sans-serif;font-size:7pt;color:#555;display:flex;justify-content:space-between;gap:4mm">
    <span>${footer ? escapeHtml(footer) : ''}</span>
    <span style="white-space:nowrap">Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;
}

/**
 * HTML → PDF with headless Chromium, on the server so a document prints the same
 * on every machine. One browser for the whole process (launching costs seconds,
 * a page costs milliseconds); a crashed browser is relaunched on the next render.
 */
@Injectable()
export class PdfRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRendererService.name);
  private browser: Promise<Browser> | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** `footer` (tenant text) is printed on every page with the page number. */
  async render(html: string, format: PrintFormat, footer: string | null): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // Templates have no script; data in them must never run as code.
      await page.setJavaScriptEnabled(false);
      // Templates are self-contained (inline CSS, no network): 'load' is enough.
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: footerTemplate(footer),
        margin: { top: '10mm', bottom: '14mm', left: '10mm', right: '10mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    if (browser) await (await browser.catch(() => null))?.close();
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browser) {
      // puppeteer is ESM-only: a static import becomes a require(), which Jest on
      // Node < 24.9 cannot load. import() works everywhere.
      const launching = Promise.all([import('puppeteer'), this.launchOptions()]).then(
        ([{ default: puppeteer }, options]) =>
          // A stuck browser fails the request instead of hanging it.
          puppeteer.launch({ ...options, protocolTimeout: 20_000 }),
      );
      this.browser = launching;
      launching
        .then((b) =>
          b.on('disconnected', () => {
            if (this.browser === launching) this.browser = null;
          }),
        )
        .catch((err: unknown) => {
          this.logger.error({ err }, 'Chromium failed to start');
          if (this.browser === launching) this.browser = null;
        });
    }
    return this.browser;
  }

  private async launchOptions(): Promise<LaunchOptions> {
    if (this.config.VERCEL === '1' && !this.config.CHROMIUM_PATH) {
      // Vercel functions have no Chromium: a build made for Lambda-like runtimes,
      // unpacked to /tmp on the first print of each instance (a few seconds).
      const { default: chromium } = await import('@sparticuz/chromium');
      const executablePath = await chromium.executablePath();
      // The fonts were unpacked to /tmp/fonts, which fontconfig reads.
      await mkdir('/tmp/fonts', { recursive: true });
      await copyFile(ARABIC_FONT, '/tmp/fonts/NotoNaskhArabic.ttf').catch((err: unknown) =>
        this.logger.warn({ err }, 'Arabic font missing: Arabic names will not print'),
      );
      return { executablePath, args: chromium.args, headless: 'shell' };
    }
    return {
      // Puppeteer's download is chrome-headless-shell; a system Chromium runs headless.
      headless: this.config.CHROMIUM_PATH ? true : 'shell',
      executablePath: this.config.CHROMIUM_PATH,
      // The API container runs as a non-root user without user namespaces.
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    };
  }
}

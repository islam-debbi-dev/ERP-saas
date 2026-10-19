/**
 * The API renders PDFs with chrome-headless-shell only (`headless: 'shell'`):
 * skip the full Chrome download (~360 MB) on `pnpm install`.
 * @type {import('puppeteer').Configuration}
 */
module.exports = {
  chrome: { skipDownload: true },
};

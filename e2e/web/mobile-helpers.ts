import { expect, type Page } from '@playwright/test';

/**
 * docs/ui.md rule 1 and 2: nothing scrolls sideways.
 *
 * - The page itself is never wider than the screen.
 * - No box inside it hides content to the side either (a table that scrolls in
 *   its container hides the balance of a client), unless the box is marked
 *   `data-scroll-x`: the big office tables that are allowed to scroll in their
 *   own container (rule 2).
 *
 * On failure the message names what sticks out, so the fix starts at the right place.
 */
export async function overflowProblems(page: Page): Promise<string[]> {
  const result = await page.evaluate(() => {
    // The device width, not innerWidth: when the content is too wide, a phone
    // browser zooms the page out and innerWidth grows with it.
    const viewport = Math.min(window.innerWidth, window.screen.width);
    const scrollWidth = document.documentElement.scrollWidth;
    const describe = (el: Element): string => {
      const id = el.id ? `#${el.id}` : '';
      const cls =
        typeof (el as HTMLElement).className === 'string'
          ? `.${(el as HTMLElement).className.trim().split(/\s+/).slice(0, 3).join('.')}`
          : '';
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };
    const visible = (el: HTMLElement): boolean => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none';
    };

    const sticking: string[] = [];
    if (scrollWidth > viewport) {
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
        if (!visible(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.right <= viewport + 1 && rect.left >= -1) continue;
        // Only the outermost element that sticks out, not all its children.
        const parent = el.parentElement?.getBoundingClientRect();
        if (parent && (parent.right > viewport + 1 || parent.left < -1)) continue;
        let clipped = false;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          if (getComputedStyle(a).overflowX !== 'visible') {
            clipped = true;
            break;
          }
        }
        if (clipped) continue;
        sticking.push(`${describe(el)} [${Math.round(rect.left)}, ${Math.round(rect.right)}]`);
        if (sticking.length >= 5) break;
      }
    }

    const hidden: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) continue;
      if (el.closest('[data-scroll-x]')) continue;
      const overflowX = getComputedStyle(el).overflowX;
      if (overflowX !== 'auto' && overflowX !== 'scroll') continue;
      if (!visible(el) || el.scrollWidth <= el.clientWidth + 1) continue;
      hidden.push(`${describe(el)} (${el.scrollWidth}px in ${el.clientWidth}px)`);
      if (hidden.length >= 5) break;
    }
    const layoutWidth = window.innerWidth;
    return { viewport, scrollWidth, sticking, hidden, layoutWidth, zoomedOut: layoutWidth > window.screen.width };
  });

  const problems: string[] = [];
  if (result.zoomedOut) problems.push(`the browser zoomed the page out to ${result.layoutWidth}px`);
  if (result.scrollWidth > result.viewport) {
    problems.push(
      `page is ${result.scrollWidth}px wide for a ${result.viewport}px screen; sticking out: ${result.sticking.join(' | ')}`,
    );
  }
  for (const box of result.hidden) problems.push(`hides content to the side: ${box}`);
  return problems;
}

/** Fails when the page or one of its boxes scrolls sideways (soft: the test goes on). */
export async function expectNoHorizontalOverflow(page: Page, opts: { soft?: boolean } = {}): Promise<string[]> {
  const problems = await overflowProblems(page);
  const check = opts.soft ? expect.soft : expect;
  check(problems, 'use cards below md, or mark an office table data-scroll-x').toEqual([]);
  return problems;
}

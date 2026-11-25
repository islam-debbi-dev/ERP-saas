import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYBOARD_SETTLE_MS, useVisibleHeight } from './use-visible-height';

/** The panel: its inline height is what the hook sets. */
function Sheet({ open }: { open: boolean }) {
  const height = useVisibleHeight(open);
  return <div data-testid="sheet" style={height ? { height } : undefined} />;
}

class FakeViewport extends EventTarget {
  height = 800;
}

const FULL = 800;
let viewport: FakeViewport;

function setViewport(height: number, event?: 'resize' | 'scroll') {
  viewport.height = height;
  if (event) act(() => void viewport.dispatchEvent(new Event(event)));
}

beforeEach(() => {
  viewport = new FakeViewport();
  viewport.height = FULL;
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: FULL, configurable: true });
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
});

const sheet = () => screen.getByTestId('sheet');

describe('useVisibleHeight', () => {
  it('leaves the height to CSS while the keyboard is closed', () => {
    render(<Sheet open />);
    expect(sheet().style.height).toBe('');
  });

  it('follows the keyboard and clears the height when it closes (resize)', () => {
    render(<Sheet open />);
    setViewport(400, 'resize');
    expect(sheet().style.height).toBe('400px');
    setViewport(FULL, 'resize');
    expect(sheet().style.height).toBe('');
  });

  it('clears the height when only a scroll event comes back (missed resize)', () => {
    render(<Sheet open />);
    setViewport(400, 'resize');
    setViewport(FULL, 'scroll');
    expect(sheet().style.height).toBe('');
  });

  it('re-reads after focusout when no event comes at all', () => {
    render(<Sheet open />);
    setViewport(400, 'resize');
    expect(sheet().style.height).toBe('400px');
    // iOS Safari: the keyboard is gone, the viewport said nothing.
    setViewport(FULL);
    act(() => void document.dispatchEvent(new Event('focusout')));
    expect(sheet().style.height).toBe('400px');
    act(() => void vi.advanceTimersByTime(KEYBOARD_SETTLE_MS));
    expect(sheet().style.height).toBe('');
  });

  it('keeps no height while closed, and stops listening', () => {
    const { rerender, unmount } = render(<Sheet open />);
    setViewport(400, 'resize');
    rerender(<Sheet open={false} />);
    expect(sheet().style.height).toBe('');
    unmount();
    expect(() => viewport.dispatchEvent(new Event('resize'))).not.toThrow();
  });
});

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCountUp } from './use-count-up';

function motion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce') }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useCountUp', () => {
  it('never moves on first load', () => {
    motion(false);
    const { result } = renderHook(() => useCountUp('1500.00'));
    expect(result.current).toEqual({ value: '1500.00', flash: false });
  });

  it('counts from the old value to the new one, then shows the exact new value', () => {
    motion(false);
    let now = 0;
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: '1000.00' },
    });
    rerender({ v: '2000.00' });
    act(() => void frames.shift()?.((now = 0)));
    act(() => void frames.shift()?.((now = 150)));
    expect(result.current).toEqual({ value: '1500.00', flash: true });
    act(() => void frames.shift()?.((now = 300)));
    expect(result.current).toEqual({ value: '2000.00', flash: false });
    expect(now).toBe(300);
  });

  it('under prefers-reduced-motion the new value shows at once, without a flash', () => {
    motion(true);
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: '1000.00' },
    });
    rerender({ v: '2000.00' });
    expect(result.current).toEqual({ value: '2000.00', flash: false });
    expect(raf).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drainToasts, showToast, TOAST_EVENT, type ToastItem } from '@/lib/toast';

const KEY = 'dc:toasts';
let received: ToastItem[];
const listener = (e: Event) => received.push((e as CustomEvent<ToastItem>).detail);

beforeEach(() => {
  sessionStorage.clear();
  received = [];
  window.addEventListener(TOAST_EVENT, listener);
});

afterEach(() => {
  window.removeEventListener(TOAST_EVENT, listener);
  vi.unstubAllGlobals();
});

describe('showToast', () => {
  it('queues the toast in sessionStorage and announces it by event', () => {
    showToast('Saved');
    const queued = JSON.parse(sessionStorage.getItem(KEY)!);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ message: 'Saved', variant: 'success' });
    expect(received).toEqual(queued);
  });

  it('defaults to success and accepts error', () => {
    showToast('Oops', 'error');
    expect(received[0].variant).toBe('error');
  });

  it('appends to an existing queue with unique ids', () => {
    showToast('one');
    showToast('two');
    const queued = JSON.parse(sessionStorage.getItem(KEY)!) as ToastItem[];
    expect(queued.map((t) => t.message)).toEqual(['one', 'two']);
    expect(queued[0].id).not.toBe(queued[1].id);
  });

  it('still announces the toast when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => showToast('still shown')).not.toThrow();
    expect(received.map((t) => t.message)).toEqual(['still shown']);
  });

  it('recovers from a corrupt queue by still announcing', () => {
    sessionStorage.setItem(KEY, '{not json');
    expect(() => showToast('x')).not.toThrow();
    expect(received).toHaveLength(1);
  });

  it('is a no-op on the server (no window)', () => {
    vi.stubGlobal('window', undefined);
    expect(() => showToast('server')).not.toThrow();
    vi.unstubAllGlobals();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(received).toHaveLength(0);
  });
});

describe('drainToasts', () => {
  it('returns every queued toast and clears the queue', () => {
    showToast('a');
    showToast('b', 'error');
    const drained = drainToasts();
    expect(drained.map((t) => [t.message, t.variant])).toEqual([
      ['a', 'success'],
      ['b', 'error'],
    ]);
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(drainToasts()).toEqual([]);
  });

  it('returns [] for an empty queue', () => {
    expect(drainToasts()).toEqual([]);
  });

  it('returns [] for corrupt JSON', () => {
    sessionStorage.setItem(KEY, 'nope');
    expect(drainToasts()).toEqual([]);
  });

  it('returns [] for a non-array value and still clears it', () => {
    sessionStorage.setItem(KEY, '{"message":"x"}');
    expect(drainToasts()).toEqual([]);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('returns [] when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(drainToasts()).toEqual([]);
  });
});

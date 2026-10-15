import { useSyncExternalStore } from 'react';

export interface Prefs {
  sound: boolean;
  /** 'system' follows the OS setting. */
  motion: 'system' | 'full' | 'reduced';
}

const KEY = 'cambio.prefs';
const listeners = new Set<() => void>();
const media = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

let prefs: Prefs = { sound: true, motion: 'system' };
try {
  prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
} catch {
  /* ignore */
}

let snapshot = derive();
function derive() {
  const reduced = prefs.motion === 'reduced' || (prefs.motion === 'system' && !!media?.matches);
  return { ...prefs, reduced };
}

media?.addEventListener('change', () => {
  snapshot = derive();
  listeners.forEach((l) => l());
});

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
  snapshot = derive();
  listeners.forEach((l) => l());
}

export function getPrefs() {
  return snapshot;
}

export function useMotionPrefs() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}

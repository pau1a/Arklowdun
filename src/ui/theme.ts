const tokenCache = new Map<string, string>();
const numberCache = new Map<string, number>();
const themeChangeListeners = new Set<() => void>();
let listenersBound = false;

export type NumberUnit = 'px' | 'ms';

function safeGetComputedStyle(element: Element | null): CSSStyleDeclaration | null {
  if (!element) return null;
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return null;
  }
  try {
    return window.getComputedStyle(element);
  } catch {
    return null;
  }
}

function readTokenValue(name: string): string {
  if (typeof document === 'undefined') return '';
  const fromElement = (element: Element | null) => {
    const styles = safeGetComputedStyle(element);
    if (!styles) return '';
    return styles.getPropertyValue(name).trim();
  };
  let value = fromElement(document.documentElement);
  if (!value) {
    value = fromElement(document.body);
  }
  return value;
}

function parseNumericValue(value: string, unit?: NumberUnit): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (unit) {
    const lowerTrim = trimmed.toLowerCase();
    const lowerUnit = unit.toLowerCase();
    if (lowerTrim.endsWith(lowerUnit)) {
      const base = trimmed.slice(0, trimmed.length - unit.length);
      const parsed = Number.parseFloat(base.trim());
      return Number.isNaN(parsed) ? null : parsed;
    }
  }
  const match = trimmed.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isNaN(parsed) ? null : parsed;
}

function notifyThemeChange(): void {
  tokenCache.clear();
  numberCache.clear();
  for (const listener of Array.from(themeChangeListeners)) {
    try {
      listener();
    } catch {
      // Ignore listener failures; theme updates should not throw.
    }
  }
}

const handleDocumentInvalidate = () => notifyThemeChange();
const handleMediaChange = () => notifyThemeChange();

function ensureListenersBound(): void {
  if (listenersBound) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  try {
    const mediaQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    if (mediaQuery) {
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleMediaChange);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handleMediaChange);
      }
    }
  } catch {
    // Ignore matchMedia issues (e.g. unsupported environments).
  }

  try {
    document.addEventListener('theme:invalidate', handleDocumentInvalidate as EventListener);
  } catch {
    // Ignore environments without addEventListener on document.
  }

  listenersBound = true;
}

export function getToken(name: string, fallback = ''): string {
  ensureListenersBound();
  const token = name.trim();
  if (!token) return fallback;
  const cached = tokenCache.get(token);
  if (cached !== undefined) {
    return cached;
  }
  const value = readTokenValue(token);
  if (value) {
    tokenCache.set(token, value);
    return value;
  }
  return fallback;
}

export function getColor(name: string, fallback = 'transparent'): string {
  const value = getToken(name);
  return value || fallback;
}

export function getNumber(name: string, unit?: NumberUnit, fallback = 0): number {
  ensureListenersBound();
  const cacheKey = `${name}|${unit ?? 'raw'}`;
  const cached = numberCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const raw = getToken(name);
  const parsed = parseNumericValue(raw, unit);
  if (parsed === null) {
    return fallback;
  }
  numberCache.set(cacheKey, parsed);
  return parsed;
}

export function onThemeChange(callback: () => void): () => void {
  ensureListenersBound();
  themeChangeListeners.add(callback);
  return () => {
    themeChangeListeners.delete(callback);
  };
}

export function invalidateThemeCache(): void {
  notifyThemeChange();
}

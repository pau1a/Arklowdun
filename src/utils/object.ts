export type Dict<V> = Record<string | number | symbol, V>;

// Overload for typed key on typed map
export function getSafe<M extends Record<PropertyKey, any>, K extends keyof M>(
  map: M,
  key: K,
): M[K] | undefined;
// Generic string key fallback
export function getSafe<V>(map: Record<string, V>, key: string): V | undefined;
// Implementation
export function getSafe(map: Record<PropertyKey, any>, key: PropertyKey): any {
  // eslint-disable-next-line security/detect-object-injection
  return Object.prototype.hasOwnProperty.call(map, key) ? (map as any)[key] : undefined;
}

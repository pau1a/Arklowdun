export function transformCallback(callback: (...args: any[]) => void) {
  return callback;
}

export async function invoke() {
  return null;
}

export function convertFileSrc(path: string): string {
  return `app://${path.replace(/^\/+/, '')}`;
}

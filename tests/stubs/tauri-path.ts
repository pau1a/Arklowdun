export async function appDataDir() {
  return '/appdata';
}

export async function join(...parts: string[]) {
  return parts.join('/');
}

export async function isPermissionGranted(): Promise<boolean> {
  return (
    (await (window as any).__TAURI__?.notification?.isPermissionGranted?.()) ??
    false
  );
}

export async function requestPermission(): Promise<string> {
  return (
    (await (window as any).__TAURI__?.notification?.requestPermission?.()) ??
    "denied"
  );
}

export async function sendNotification(options: {
  title: string;
  body: string;
}): Promise<void> {
  await (window as any).__TAURI__?.notification?.sendNotification?.(options);
}

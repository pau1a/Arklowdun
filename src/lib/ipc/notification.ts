import {
  isPermissionGranted as tauriIsPermissionGranted,
  requestPermission as tauriRequestPermission,
  sendNotification as tauriSendNotification,
} from "@tauri-apps/plugin-notification";

export async function isPermissionGranted(): Promise<boolean> {
  return tauriIsPermissionGranted();
}

export async function requestPermission(): Promise<
  "granted" | "denied" | "default"
> {
  return tauriRequestPermission();
}

export async function sendNotification(options: {
  title: string;
  body: string;
}): Promise<void> {
  await tauriSendNotification(options);
}

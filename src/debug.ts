// src/debug.ts

// Loud global JS errors
window.addEventListener("error", (e) => {
  const msg = `JS Error: ${e.message}\n${e.error?.stack ?? ""}`;
  console.error(msg);
});

window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
  const reason: any = e.reason;
  const msg = `Unhandled Promise Rejection:\n${
    typeof reason === "object" ? JSON.stringify(reason, null, 2) : String(reason)
  }`;
  console.error(msg);
});


export function showError(err: unknown, context?: string) {
  const msg = err instanceof Error
    ? `${context ?? "Error"}: ${err.message}`
    : typeof err === "string"
    ? `${context ?? "Error"}: ${err}`
    : `${context ?? "Error"}: ${JSON.stringify(err)}`;
  console.error(err);
  alert(msg);
}

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection", e.reason);
  showError(e.reason, "Unhandled Promise Rejection");
});


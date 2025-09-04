# Arklowdun Master Plan

This document defines the high-level strategic issues that guide development of the project.  
It is not a task list — it is a compass. Every change in the repo should map to one or more of these issues.

---

## 1. Data Integrity & Safety
Protect user data from corruption or loss.  
- Atomic database and file writes.  
- WAL + fsync tuning.  
- Verified crash recovery.  
- Schema versioning tied to app version.  
- Safe backups and restores with compatibility checks.  
- Attachments stored with quotas and hash verification.  

---

## 2. Security & Boundaries
Constrain what the app can touch.  
- Minimal Tauri FS allowlist.  
- Canonicalised, root-scoped file operations.  
- Reject symlink and UNC escapes.  
- Strict IPC request/response validation.  
- Supply-chain and licensing hygiene.  

---

## 3. Reliability & Observability
Make failures predictable and diagnosable.  
- Stable error taxonomy mapped end-to-end.  
- Panic fences around all Rust invoke handlers.  
- Crash artifacts with IDs and context.  
- Structured JSON logs with rotation.  
- Performance budgets enforced under load.  

---

## 4. User Trust & Continuity
Build and maintain confidence.  
- Signed and notarised releases.  
- Reproducible builds with embedded metadata.  
- Clear lifecycle policies for tombstones, purges, and settings.  
- Consistent, transparent upgrade paths.  

---

## 5. Evolution & Extensibility
Ensure the app can grow safely.  
- Modular architecture with well-defined boundaries.  
- Versioned migrations for new features.  
- Test scaffolding to guard against regressions.  
- Safe extension of models (e.g., recurrence rules).  

---

## 6. Ecosystem Fit
Make the app work in the real world.  
- Interoperability with external formats (CSV, ICS, JSON).  
- OS integration (file pickers, notifications, update channels).  
- Sustainable update and support strategy.  

---

## 7. Frontend Productisation
Elevate the UI from scaffolding to product.  
- Establish a design system and style guide.  
- Deliver coherent workflows for notes, calendar, and file management.  
- Accessibility support (keyboard, focus, labels).  
- User-facing performance: cold start, view render, navigation latency.  

---

## Closing Note
Every PR and every feature should answer one question:  
**Which of these seven strategic issues does this serve?**  
If it serves none, it doesn’t belong.


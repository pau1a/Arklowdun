# Interesting Node.js Tools (Beyond Playwright)

Playwright is the "eyes and hands" of browser automation.  
These tools extend Node.js in other powerful directions:

---

## Browser Automation Ecosystem
- **Puppeteer** → Google-backed headless Chrome automation (older, Chrome-only).  
- **Playwright** → Modern, cross-browser automation (Chromium, Firefox, WebKit).  
- **Browserless** → Hosted headless Chrome as a service (send JSON tasks, get results).

---

## Communication
- **Nodemailer** → Send e-mails (SMTP, Gmail, Outlook) with HTML templates and attachments.  
  *Use case*: scrape data with Playwright → send daily summary via email.

---

## Media Handling
- **Sharp** → Fast image manipulation (resize, crop, optimise).  
- **PDFKit** → Programmatic PDF generation.  
- **Playwright/Puppeteer PDF** → Rendered HTML → PDF output.  
  *Use case*: screenshots, reports, or invoices.

---

## Automation & Orchestration
- **Node-RED** → Flow-based low-code automation for APIs/IoT.  
- **BullMQ / Agenda** → Job queues with Redis (schedules, retries, distributed runs).  
- **PM2** → Process manager for keeping Node apps/scripts alive.

---

## Data & State
- **Lowdb** → Lightweight JSON DB.  
- **SQLite + Prisma** → Relational DB with a strong TypeScript ORM.  
  *Use case*: persist state across Playwright sessions.

---

## Real-Time & CLI Tools
- **Socket.IO / WS** → Real-time communication over WebSockets.  
- **Commander.js / Yargs** → Build proper CLI tools with flags, args, and help text.  
- **Execa** → Clean wrapper for running shell commands inside Node scripts.

---

## Desktop Bundling
- **Electron** → Bundle Node + browser UI into desktop apps.  
- **Tauri (with Node)** → Lightweight desktop apps using Rust backend and web front-end.  

---

## Shortlist: Best Pairs with Playwright
If you’re building *real automations* (not just demos), these combine well:
1. **Nodemailer** → notify or report results.  
2. **Sharp + PDFKit** → screenshots → processed assets → reports.  
3. **BullMQ** → manage scheduled or repeated browser tasks.  
4. **Lowdb / SQLite** → persist state between runs.  
5. **PM2** → run automations continuously, restart on crash.
```

Would you like me to also give you a **filename suggestion and placement** (e.g. `docs/node-tools.md`) so it drops in cleanly alongside your other docs?

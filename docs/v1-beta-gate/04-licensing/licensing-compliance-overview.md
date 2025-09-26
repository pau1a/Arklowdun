# Licensing & Compliance Work Overview

The gate calls for an automated NOTICE/CREDITS bundle, complete attribution for bundled fonts and icons, and a documented copyleft audit so the distribution package satisfies every licensing obligation. None of the supporting machinery is in place yet, so the body of work is predominantly greenfield.

## NOTICE/CREDITS automation

The application depends on sizeable npm and Cargo graphs (`package-lock.json` and `src-tauri/Cargo.lock`) spanning the React/TypeScript frontend, Playwright tooling, Font Awesome assets, and the Rust/Tauri runtime. Meeting the requirement means inventorying licenses across both ecosystems, normalising the metadata, and emitting a single NOTICE artifact (or a pair, if that proves clearer) without manual curation. Because the Tauri bundle currently only ships a diagnostics guide in its resources, the build configuration also has to stage the generated notice file(s) so they ship with every artifact produced in CI. The pipeline should fail builds whenever the notice step drifts out of sync with the lockfiles; the exit condition hinges on ongoing compliance, not a one-off report.

## Font and icon attribution

Font Awesome is imported directly from the vendored npm package, so the notice mechanism must surface the trademark and licensing statements required by the OFL/CC-BY mix, not just a generic MIT summary. The repository also stores Inter variable fonts locally, and their OFL obligations need to be documented and surfaced both in-app and in the accompanying NOTICE. That likely means explicit acknowledgements inside the UI (about dialog, help screen, etc.) with mirrored coverage in the shipped documentation.

## Copyleft audit and documentation

There is no existing `docs/licensing.md` capturing audit findings or distribution procedures, and the gate entry under `docs/v1-beta-gate/04-licensing/` remains a placeholder. The audit must therefore start from scratch: classify each dependency by license, confirm no GPL/LGPL transitive pulls exist, document how binaries satisfy attribution/source-offer obligations, and codify the steps developers follow when dependencies change. The resulting guide belongs at the mandated path and should become part of release sign-off.

## Overall assessment

Delivering the gate requires tooling to extract and validate dependency metadata, build-system integration so the generated notices ship with artifacts, UI and documentation updates to surface attribution, and a sustainable copyleft review process. Until these capabilities exist, the licensing checklist remains effectively untouched.

# Vehicles Module — Path to Finished Product

## 1. Schema Finalisation
Complete the data backbone.  
Extend the `vehicles` table with all accepted attributes and indices, and finalise foreign keys and soft-delete rules.  
**Outcome:** stable schema requiring no further edits.

## 2. IPC Surface Upgrade
Bring backend commands to parity with schema.  
Update Rust structs and Zod contracts for the new fields, ensuring all CRUD paths are transactional and error-typed.  
**Outcome:** deterministic IPC layer covering every field cleanly.

## 3. Repository & State Store
Improve frontend data handling.  
Add caching, invalidation, and refresh hooks to `vehiclesRepo.ts`.  
**Outcome:** smooth, low-latency data flow between UI and backend.

## 4. UI — List View
Make the vehicle list production-grade.  
Implement grid layout, sorting, filtering, and virtualization; add visible states for active, overdue, and archived vehicles.  
**Outcome:** responsive list view that feels complete.

## 5. UI — Detail & Edit
Turn the detail pane into a full editor.  
Build editable form with inline validation and toast feedback.  
**Outcome:** no-reload editing and an intuitive workflow.

## 6. Maintenance & Attachments
Expose maintenance and document history.  
Create sub-list for MOT, service, and insurance records; enable add/open/reveal/delete through the vault guard.  
**Outcome:** clear, safe attachment handling for every vehicle.

## 7. Diagnostics & Export
Ensure recoverability and supportability.  
Extend diagnostics counters and manifest entries for vehicles; include orphan scans and health checks for maintenance files.  
**Outcome:** reliable diagnostics and backup coverage.

# Changelog - wb-backend

All notable changes to the CA-bOt WhatsApp Bot Backend will be documented in this file.

## [1.7.0] - 2026-06-12
### Added
- **Auto-Resume Incomplete ITR Filings**:
  - Updated `routeToNextOnboardingStep` inside `whatsapp.controller.ts` to query active filing records for returning approved clients.
  - Automatically welcomes them back and resumes their ITR filing at their last incomplete step (instead of redirecting to the primary service selection menu).
- **Service Menu Interaction Guidance**:
  - Appended clear, explicit instructions to primary WhatsApp service menus (e.g. `"Reply *1* to select."`) to prevent user navigation confusion.

## [1.6.0] - 2026-05-26
### Added
- **Automated WhatsApp Document Reminder Scheduler**:
  - Implemented persistent background scheduler service `reminder.service.ts` linked to JSON file-system storage (`reminder-settings.json`).
  - Automatically checks active ITR filings with pending document requirements (`AWAITING_FORM16`, `AWAITING_BANK_STATEMENT`, etc.).
  - Builds and dispatches tailored, friendly reminder messages sequentially using `messageService`.
  - Added REST API routes `/api/reminders/status`, `/api/reminders/toggle`, and `/api/reminders/trigger` to give the client web dashboard complete administrative control.

## [1.5.0] - 2026-05-23
### Added
- **Conversation Backtracking (`back` / `undo` commands)**:
  - Added a universal backtrack handler in `whatsapp.controller.ts`.
  - Captures `back` or `undo` case-insensitive commands.
  - Automatically nulls/clears the previously entered column in the database (safeguarding database integrity).
  - Transitions client registration state (`bot_status`) or filing status back to the preceding step.
  - Promptly re-triggers the correct query message for that step, giving users an intuitive way to correct errors in real-time.

## [1.4.0] - 2026-05-23
### Changed
- **Provider-Based Messaging Architecture**:
  - Abstracted WhatsApp messaging into a generic `IWhatsAppProvider` interface.
  - Created `BaileysProvider` to encapsulate all `@whiskeysockets/baileys` logic.
  - Added a stub `CloudProvider` for future migration to WhatsApp Cloud API.
  - Added `WHATSAPP_PROVIDER` environment variable (defaults to `baileys`) for easy provider swapping.
  - Refactored `whatsapp.controller.ts` and `index.ts` to use a global singleton `messageService` without any direct coupling to Baileys.

## [1.3.1] - 2026-05-23
### Changed
- **Dynamic Onboarding Step Routing**:
  - Refactored registration flow into a centralized `routeToNextOnboardingStep` dispatcher that checks each field (DOB, email, PAN, Aadhaar) dynamically against the database before prompting.
  - Clients whose documents were uploaded via the admin UI are seamlessly skipped during WhatsApp onboarding.
  - Fixed duplicate JID constraint error (`23505`) by deleting the temporary client record before linking the pre-registered one.

## [1.3.0] - 2026-05-23
### Added
- **Automatic Identity Merging & JID Linking**:
  - Developed real-time lookup of pre-registered entries on inputting mobile numbers during bot onboarding.
  - Automatically merges active session WhatsApp LIDs into pre-registered records, cleanly deleting draft/temporary accounts first to release unique `whatsapp_jid` constraints seamlessly.
- **Document-Aware Onboarding Skipping**:
  - Implemented a smart `routeToNextOnboardingStep` dispatcher checking database documents dynamically before prompt routing.
  - Automatically bypasses PAN/Aadhaar card upload requests if those files have already been uploaded by the CA or user through the web UI dashboard.
- **Verification-Aware Onboarding Completion**:
  - Dynamically skips sending "docs under review" pending alerts when onboarding completes if the CA team has already marked the account as `APPROVED` on the admin panel.

## [1.2.0] - 2026-05-23
### Added
- **Smart Progress-Aware WhatsApp Bot Responses**:
  - Overhauled response routing inside `whatsapp.controller.ts` to actively query Supabase.
  - Dynamically customizes greetings to clients based on filing status: returns a detailed receipt warning if already filed (`FILED`), verification notes if approved (`DOCS_VERIFIED`), or pending audit warnings if in progress.

## [1.1.0] - 2026-05-19
### Changed
- **Migration from Twilio to Baileys**:
  - Successfully migrated connection libraries from Twilio sandboxes to direct local Baileys execution to secure communication flows.

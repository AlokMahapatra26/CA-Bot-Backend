# Changelog - wb-backend

All notable changes to the CA-bOt WhatsApp Bot Backend will be documented in this file.

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

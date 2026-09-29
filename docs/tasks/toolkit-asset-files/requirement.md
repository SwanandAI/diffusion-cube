# Requirement: Store Toolkit Asset Files and Surface Them in Conversation

**Source:** Product Charter backlog item "Store toolkit-asset files, surface them in conversation" (Functional, status *In Progress* per the charter; see `docs/wiki/diffusion-cube/business/business-overview.md` → Roadmap). Requested by Anurag Goutam, 2026-09-29.

> Status: **Final scope, approved 2026-09-29.** Engineering detail is in [`plan.md`](plan.md); build tasks are in [`task-list.md`](task-list.md).

## The problem today

Every pathway in 100 Pathways describes "toolkit assets": ready-made things another team can reuse, such as a cost model, a checklist, an architecture note, a test set or a glossary. Today these are only **described in words** inside the pathway write-up. The real files never reach the app. At best the text says "documented in the MahaVISTAAR Architecture Note (contact: EkStep Foundation)", and an adopter who wants the asset has to hunt for it themselves.

## What we are building

1. **Contributors attach the real asset.** While working on their pathway in the Contribute area, a contributor can upload the actual file (PDF, Word/Excel/PowerPoint, ZIP, or image, up to 25 MB) or paste a link (for example a GitHub repository).
2. **The assistant checks it, and the contributor confirms.** The assistant first checks whether the upload is genuinely a reusable asset (a template, checklist, tool) rather than ordinary background material. If it is, the contributor sees two explicit questions: *"Is this a toolkit asset?"* and *"OK to share with other adopters?"*. Only if both answers are **Yes** is the file kept. If either is **No**, the file is not stored anywhere.
3. **An admin approves each asset.** Every asset waits for an admin to approve or reject it, even when it is added to a pathway that is already live. Contributors can see whether each asset is pending, approved or rejected.
4. **The pathway document is updated.** When an asset is approved, the pathway's own write-up lists it (name, what it's for, when to reuse it) everywhere the pathway is stored. This happens immediately on approval, without a separate "publish pathway" step.
5. **Adopters get it when it's relevant.** In the Analyse area, when an adopter's project matches a pathway (same sector and same kind of problem), the assistant suggests that pathway's approved assets. A download card appears under its reply. Example: someone building something similar to MahaVISTAAR sees the assets MahaVISTAAR shared.

## Who it's for

- **Adopters (Explorers):** get concrete, reusable material in the flow of their conversation, not just a description of it.
- **Contributors:** their reusable work is actually reused. This is also the groundwork for the charter's later "Incentivize Contributors" milestone (15-Jan-27).
- **Admins / Program Team:** keep control over what is shared, one asset at a time.

## Deliberately not included in this release

- Assets are **only** offered inside the Analyse conversation. They do not appear in the public Explore library, the pathway browse pages, or the Analysis Document.
- **No way to withdraw an asset** once it is approved (neither admin nor contributor), in this release.
- **Existing assets** already described in the 36 corpus write-ups are not backfilled; only newly uploaded assets are included.
- No licence field, and no admin uploads.
- Enhancements (a toolkit catalogue page, "adapt this template for me", download counts and feedback, versioning) are listed as a future roadmap in `plan.md`, not built now.

## Trade-offs and risks, in plain terms

- **Files are stored in Amazon S3**, a new service for this app alongside the existing database. It needs one-time manual setup and new credentials on the hosting platform.
- **The AWS account is a free account that expires in December 2026** (per the Product Charter). Stored asset files must be moved to the replacement account before then, or they will be lost.
- **Uploaded files are not scanned** for viruses or personal data. The admin review is the only check for now; automated scanning is a separate charter item that hasn't started.
- **The AI account that powers the assistant expires 28-Oct-2026.** If it isn't renewed, the "is this an asset?" check and the in-conversation suggestions stop working. Uploading, approving and downloading keep working.

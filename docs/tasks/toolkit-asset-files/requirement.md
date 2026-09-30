# Requirement: Store Toolkit Asset Files and Surface Them in Conversation

**Source:** Product Charter backlog item "Store toolkit-asset files, surface them in conversation" (Functional, status *In Progress* per the charter; see `docs/wiki/diffusion-cube/business/business-overview.md` → Roadmap). Requested by Anurag Goutam, 2026-09-29; scope revised 2026-09-30.

> Status: **Final scope, approved 2026-09-30.** Engineering detail is in [`plan.md`](plan.md); build tasks are in [`task-list.md`](task-list.md).

## The problem today

Every pathway in 100 Pathways describes "toolkit assets": ready-made things another team can reuse, such as a cost model, a checklist, an architecture note or a glossary. Today these are only **described in words** inside the pathway write-up. The real files never reach the app, so someone who wants the asset has to hunt for it themselves.

## What we are building

1. **Contributors attach the real asset.** While working on their pathway in the Contribute area, a contributor can upload the actual file (PDF, Word, PowerPoint, Excel, CSV/text, or image, up to 25 MB) or paste a link, for example a GitHub repository. ZIP files are not supported yet.
2. **The assistant spots it, and the contributor gives permission.** The assistant checks whether the upload is genuinely a reusable asset (a template, checklist or tool) rather than ordinary background material. If it is, the contributor is asked one question: *"OK to share this publicly? Anyone using 100 Pathways, including visitors who aren't signed in, will be able to download it."* If they say **No**, the file is not kept.
3. **Assets are approved together with the pathway.** When the contributor sends the pathway for review, its asset list is added to the pathway write-up. The admin reviews the assets as part of the pathway, with a preview of each file. When the admin approves the pathway, its assets go live with it; there is no separate approval step for assets. An asset added after the pathway was sent for review goes live the next time the pathway is reviewed and approved.
4. **The assistant offers the assets in conversation.** Assets are not shown as a fixed list on screen. The assistant brings them up when they're relevant, and a download card appears under its reply:
   - **Explore (public library):** after a bit of conversation about a pathway, or as soon as someone asks about tools, templates or how to reuse it, the assistant says something like "these are the assets associated with this pathway".
   - **Analyse:** when someone's own project matches a pathway (same sector and same kind of problem), the assistant suggests that pathway's assets.
5. **Anyone can download.** Approved assets can be viewed and downloaded by anyone, with no sign-in needed.

## Who it's for

- **Anyone exploring or analysing:** gets concrete, reusable material in the flow of the conversation.
- **Contributors:** their reusable work actually gets reused. This is groundwork for the charter's later "Incentivize Contributors" milestone (15-Jan-27).
- **Admins / Program Team:** review assets in the same step as the pathway, with no extra queue.

## Deliberately not included in this release

- ZIP files, a licence field, and admin uploads.
- Approving or rejecting individual assets. It's all or nothing with the pathway; to drop an asset, the admin asks the contributor to revise before approving.
- Withdrawing an asset once it's live.
- A fixed on-screen list of assets. Assets appear only through the conversation.
- Assets on the built-in curated pathways (MahaVISTAAR, Blue Dots and others) until they exist as contributor pathways, and backfilling the assets already described in existing write-ups.
- Enhancements (a toolkit catalogue, "adapt this template for me", download counts and feedback, versioning) are listed as a future roadmap in `plan.md`.

## Trade-offs and risks, in plain terms

- **Assets become public.** Once a pathway is approved, its files can be downloaded by anyone on the internet. The permission question says so plainly. It should be checked against the Terms of Use before launch.
- **There are no download limits yet**, so heavy or automated downloading could raise storage bandwidth costs. Adding limits is recommended; it ties in with the security review.
- **Files aren't scanned** for viruses or personal data. The admin's review of the pathway is the only check.
- **Discovery depends on the conversation.** Someone who never chats beyond the first overview won't be offered the assets. A fixed list is a possible fallback later.
- **The AI account expires 28-Oct-2026.** If it isn't renewed, the "is this an asset?" check and the in-conversation suggestions stop working. Uploading, approving and downloading keep working.

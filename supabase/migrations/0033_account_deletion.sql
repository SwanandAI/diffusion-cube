-- Self-serve account deletion (app/api/account/delete) removes the auth user
-- and lets every per-user table cascade away with it — conversations
-- (designs → design_documents/adoption_queries, library_conversations),
-- roles, registrations, contributor links. Published content must survive,
-- so the three FKs that would otherwise block or wipe it are relaxed here.
-- See specs/ACCOUNT_DELETION_SPEC.md.

-- 1. published_pathways.published_by had no ON DELETE action, so deleting
--    anyone who ever published blocked the whole delete. Keep the row,
--    forget who published it.
alter table public.published_pathways
  drop constraint if exists published_pathways_published_by_fkey;
alter table public.published_pathways
  add constraint published_pathways_published_by_fkey
  foreign key (published_by) references auth.users (id) on delete set null;

-- 2. pathways.{assembled,published}_design_doc_id point into the deleting
--    user's design_documents (which cascade away). The live text is already
--    in pathways.content_cache / published_pathways.content, so only the
--    pointer is lost.
alter table public.pathways
  drop constraint if exists pathways_assembled_design_doc_id_fkey,
  drop constraint if exists pathways_published_design_doc_id_fkey;
alter table public.pathways
  add constraint pathways_assembled_design_doc_id_fkey
    foreign key (assembled_design_doc_id) references public.design_documents (id) on delete set null,
  add constraint pathways_published_design_doc_id_fkey
    foreign key (published_design_doc_id) references public.design_documents (id) on delete set null;

-- 3. contribution_units.user_id cascaded, which would delete a contributor's
--    published units along with their drafts. Published units now outlive
--    their author (user_id → null); the delete route removes unpublished
--    drafts explicitly first.
alter table public.contribution_units
  alter column user_id drop not null;
alter table public.contribution_units
  drop constraint if exists contribution_units_user_id_fkey;
alter table public.contribution_units
  add constraint contribution_units_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

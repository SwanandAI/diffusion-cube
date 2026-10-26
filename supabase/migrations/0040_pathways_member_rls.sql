-- pathways.content_cache holds a pathway's assembled document from the moment
-- a contributor sends it for review — before any admin has published it. The
-- 0020 policy let every signed-in user select every row, so (with every
-- signup an adopter since 0039) anyone could read every unpublished document
-- straight from the REST API. A session now sees only the pathways it
-- contributes to, plus everything for an 'admin' role.
--
-- What still needs every pathway reads it with the service role, listing
-- columns only: GET /api/pathways (contributors' selector), check-similar,
-- the join route's existence check, and /api/admin/pathways/document (which
-- also covers ADMIN_EMAILS admins, invisible to RLS). Deploy that code before
-- running this migration — the previous code listed pathways through the
-- session client and would see only the caller's own.

drop policy if exists "Signed-in users can view pathways" on public.pathways;

create policy "Contributors and admins can view their pathways"
  on public.pathways for select
  using (
    exists (
      select 1 from public.pathway_contributors pc
      where pc.pathway_id = pathways.id and pc.user_id = auth.uid()
    )
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'admin'
    )
  );

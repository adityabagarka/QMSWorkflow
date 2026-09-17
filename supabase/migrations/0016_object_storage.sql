-- 0016_object_storage.sql
-- Private object storage for policy copies, member rosters and claims files.
-- Reference: ARCHITECTURE.md §3.1, §15, §16.
--
-- Supabase Storage is used rather than a separate S3 bucket: it is already in
-- the stack, and it speaks the S3 protocol, so the §3.1 requirement to avoid
-- host-proprietary blob storage still holds and the lift-and-shift stays a
-- credentials change.
--
-- The `storage` schema exists only on Supabase, so everything here is guarded.
-- On a local or CI Postgres this migration is a no-op, which keeps the test
-- suite runnable without a Supabase instance.

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema absent (local or CI Postgres) — skipping bucket setup';
    return;
  end if;

  -- Private. A signed URL, minted per request for someone who has already
  -- passed the checks below, is the only way to read one of these files.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'case-documents',
    'case-documents',
    false,
    52428800, -- 50 MB; comfortably above a scanned policy, well below a mistake
    array[
      'application/pdf',
      'image/png',
      'image/jpeg',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
  )
  on conflict (id) do update
    set file_size_limit   = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
end
$$;

-- --------------------------------------------------------------------------
-- Access.
--
-- Files inherit the permissions of the case they belong to. That is the whole
-- design: §15 says a bug in application-layer checks must not leak deal data,
-- and a census file is the most sensitive thing in the system. It would be
-- pointless to enforce the span model on `cases` and then serve the roster
-- behind a URL anyone could reach.
--
-- The path convention carries the case id, so the rules can find it:
--
--     case-documents/cases/<case_id>/<kind>/<filename>
--
-- This function is defined unconditionally, and splits the path itself rather
-- than calling storage.foldername(). It decides which case a file belongs to,
-- and therefore who may read it, so it has to be exercisable on a plain
-- Postgres — a security rule that can only be tested in production is not
-- being tested.
--
-- It fails closed: anything that is not exactly the path we write returns null,
-- and a null case id matches no policy below.
-- --------------------------------------------------------------------------
create or replace function app.storage_case_id(object_name text)
returns uuid
language plpgsql
immutable
as $body$
declare
  parts text[] := string_to_array(coalesce(object_name, ''), '/');
begin
  -- cases / <uuid> / <filename> is the shortest valid shape.
  if array_length(parts, 1) is null or array_length(parts, 1) < 3 then
    return null;
  end if;
  if parts[1] <> 'cases' then
    return null;
  end if;
  return parts[2]::uuid;
exception
  when invalid_text_representation then
    -- Covers a non-uuid segment, including a '..' traversal attempt.
    return null;
end;
$body$;

comment on function app.storage_case_id(text) is
  'Which case a stored object belongs to, from its path. Returns null for anything malformed, so a bad path matches no access policy rather than resolving to another case.';

-- --------------------------------------------------------------------------
-- The policies themselves need the storage schema, which exists only on
-- Supabase.
-- --------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema absent (local or CI Postgres) — skipping object policies';
    return;
  end if;

  execute $p$
    drop policy if exists case_documents_select on storage.objects;
    create policy case_documents_select on storage.objects for select to authenticated
      using (
        bucket_id = 'case-documents'
        and app.storage_case_id(name) is not null
        and app.can_read_case(app.case_owner(app.storage_case_id(name)))
      );
  $p$;

  execute $p$
    drop policy if exists case_documents_insert on storage.objects;
    create policy case_documents_insert on storage.objects for insert to authenticated
      with check (
        bucket_id = 'case-documents'
        and app.storage_case_id(name) is not null
        and app.can_write_case(app.case_owner(app.storage_case_id(name)))
      );
  $p$;

  -- No update policy: an uploaded file is never edited in place. A correction
  -- is a new upload, so the original stays available as evidence.
  execute $p$
    drop policy if exists case_documents_delete on storage.objects;
    create policy case_documents_delete on storage.objects for delete to authenticated
      using (
        bucket_id = 'case-documents'
        and app.storage_case_id(name) is not null
        and app.can_write_case(app.case_owner(app.storage_case_id(name)))
      );
  $p$;
end
$$;

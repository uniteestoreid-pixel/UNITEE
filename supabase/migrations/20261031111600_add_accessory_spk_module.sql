-- Separate accessory production orders from jersey/batik SPK records.
-- Uses the same authenticated workspace membership; no existing SPK rows are changed.

create table if not exists public.accessory_spk_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  spk_no text not null,
  version integer not null default 1 check (version > 0),
  customer text not null check (char_length(btrim(customer)) between 1 and 200),
  order_name text not null check (char_length(btrim(order_name)) between 1 and 200),
  order_date date,
  deadline date,
  requested_by text not null default '',
  items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 40),
  total_quantity integer not null default 0 check (total_quantity > 0),
  notes text not null default '',
  ap_designer text not null default '',
  ap_cs text not null default '',
  ap_customer text not null default '',
  ap_production text not null default '',
  reference_image_path text,
  reference_image_name text,
  reference_image_mime_type text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, spk_no)
);

create index if not exists accessory_spk_records_workspace_updated_idx
  on public.accessory_spk_records(workspace_id, updated_at desc)
  where deleted_at is null;

alter table public.accessory_spk_records enable row level security;

drop policy if exists "workspace members can read accessory SPKs" on public.accessory_spk_records;
create policy "workspace members can read accessory SPKs"
  on public.accessory_spk_records
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

drop policy if exists "workspace members can create accessory SPKs" on public.accessory_spk_records;
create policy "workspace members can create accessory SPKs"
  on public.accessory_spk_records
  for insert to authenticated
  with check (
    private.is_workspace_member(workspace_id)
    and created_by = (select auth.uid())
  );

drop policy if exists "workspace members can update accessory SPKs" on public.accessory_spk_records;
create policy "workspace members can update accessory SPKs"
  on public.accessory_spk_records
  for update to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

-- The Data API now requires explicit grants for newly created public tables.
-- No anonymous/public role is granted access; RLS still applies to every row.
revoke all on table public.accessory_spk_records from public, anon;
grant select, insert, update on table public.accessory_spk_records to authenticated;
revoke delete on table public.accessory_spk_records from authenticated;

-- Optional reference images remain in the existing private bucket.
-- Existing read/delete policies already restrict the first path segment to an active workspace member.
drop policy if exists "workspace members can upload SPK design files and admins can upload logos" on storage.objects;
create policy "workspace members can upload SPK design files and admins can upload logos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'spk-files'
    and (
      (split_part(name, '/', 2) = 'spk'
        and private.is_workspace_member(private.storage_workspace_id(name)))
      or
      (split_part(name, '/', 2) = 'accessories'
        and private.is_workspace_member(private.storage_workspace_id(name)))
      or
      (split_part(name, '/', 2) = 'logos'
        and private.is_workspace_admin(private.storage_workspace_id(name)))
    )
  );

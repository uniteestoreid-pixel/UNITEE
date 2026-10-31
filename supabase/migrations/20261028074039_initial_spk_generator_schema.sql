-- Initial schema for SPK Generator cloud.
-- Safe for a newly-created project. This migration intentionally creates no user or SPK sample records.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_status_idx
  on public.workspace_members(user_id, status, created_at);

create table if not exists public.company_logos (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  slot integer not null check (slot between 1 and 4),
  label text not null default 'Logo',
  storage_path text,
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, slot)
);

create table if not exists public.spk_records (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  spk_no text not null,
  version integer not null default 1 check (version > 0),
  customer text not null default '',
  order_name text not null default '',
  order_date date,
  deadline date,
  model_kerah text not null default '',
  material text not null default '',
  colour text not null default '',
  quantity integer not null default 0 check (quantity >= 0),
  notes text not null default '',
  ap_designer text not null default '',
  ap_cs text not null default '',
  ap_customer text not null default '',
  ap_production text not null default '',
  selected_logo_id text,
  selected_logo_label text not null default '',
  selected_logo_storage_path text,
  design_storage_path text,
  design_file_name text not null default 'design',
  design_mime_type text not null default 'image/jpeg',
  design_file_size bigint not null default 1 check (design_file_size >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, spk_no)
);
create index if not exists spk_records_workspace_updated_idx
  on public.spk_records(workspace_id, updated_at desc);
create index if not exists spk_records_workspace_deleted_idx
  on public.spk_records(workspace_id, deleted_at);

create table if not exists public.spk_sizes (
  spk_id text not null references public.spk_records(id) on delete cascade,
  category text not null,
  size_label text not null,
  quantity integer not null default 0 check (quantity >= 0),
  primary key (spk_id, category, size_label)
);

create table if not exists public.spk_approvals (
  spk_id text not null references public.spk_records(id) on delete cascade,
  approval_type text not null check (approval_type in ('designer','cs','customer','production')),
  approver_name text not null default '',
  primary key (spk_id, approval_type)
);

create table if not exists public.spk_design_files (
  spk_id text primary key references public.spk_records(id) on delete cascade,
  file_size bigint not null default 0 check (file_size >= 0),
  mime_type text not null default 'image/jpeg',
  file_name text not null default 'design',
  storage_path text not null
);

create table if not exists public.spk_number_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  counter_date date not null,
  last_seq integer not null default 0 check (last_seq >= 0),
  primary key (workspace_id, counter_date)
);

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_workspace_id is not null and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
  );
$$;

create or replace function private.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_workspace_id is not null and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
      and wm.role = 'admin'
  );
$$;

create or replace function private.can_read_spk(p_spk_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.spk_records r
    where r.id = p_spk_id and private.is_workspace_member(r.workspace_id)
  );
$$;

create or replace function private.storage_workspace_id(p_name text)
returns uuid
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_first text;
begin
  v_first := split_part(coalesce(p_name, ''), '/', 1);
  if v_first !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v_first::uuid;
exception when others then
  return null;
end;
$$;

grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_admin(uuid) to authenticated;
grant execute on function private.can_read_spk(text) to authenticated;
grant execute on function private.storage_workspace_id(text) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.company_logos enable row level security;
alter table public.spk_records enable row level security;
alter table public.spk_sizes enable row level security;
alter table public.spk_approvals enable row level security;
alter table public.spk_design_files enable row level security;
alter table public.spk_number_counters enable row level security;

drop policy if exists "workspace members can read workspaces" on public.workspaces;
create policy "workspace members can read workspaces"
  on public.workspaces for select to authenticated
  using (private.is_workspace_member(id));

drop policy if exists "users can read own membership or workspace admins can read all" on public.workspace_members;
create policy "users can read own membership or workspace admins can read all"
  on public.workspace_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_workspace_admin(workspace_id));

drop policy if exists "workspace members can read company logos" on public.company_logos;
create policy "workspace members can read company logos"
  on public.company_logos for select to authenticated
  using (private.is_workspace_member(workspace_id));

drop policy if exists "workspace admins can insert company logos" on public.company_logos;
create policy "workspace admins can insert company logos"
  on public.company_logos for insert to authenticated
  with check (private.is_workspace_admin(workspace_id)
    and (created_by is null or created_by = (select auth.uid())));

drop policy if exists "workspace admins can update company logos" on public.company_logos;
create policy "workspace admins can update company logos"
  on public.company_logos for update to authenticated
  using (private.is_workspace_admin(workspace_id))
  with check (private.is_workspace_admin(workspace_id)
    and (created_by is null or created_by = (select auth.uid())));

drop policy if exists "workspace admins can delete company logos" on public.company_logos;
create policy "workspace admins can delete company logos"
  on public.company_logos for delete to authenticated
  using (private.is_workspace_admin(workspace_id));

drop policy if exists "workspace members can read SPK records" on public.spk_records;
create policy "workspace members can read SPK records"
  on public.spk_records for select to authenticated
  using (private.is_workspace_member(workspace_id));

drop policy if exists "workspace members can read SPK sizes" on public.spk_sizes;
create policy "workspace members can read SPK sizes"
  on public.spk_sizes for select to authenticated
  using (private.can_read_spk(spk_id));

drop policy if exists "workspace members can read SPK approvals" on public.spk_approvals;
create policy "workspace members can read SPK approvals"
  on public.spk_approvals for select to authenticated
  using (private.can_read_spk(spk_id));

drop policy if exists "workspace members can read SPK design metadata" on public.spk_design_files;
create policy "workspace members can read SPK design metadata"
  on public.spk_design_files for select to authenticated
  using (private.can_read_spk(spk_id));

grant usage on schema public to authenticated;
grant select on public.workspaces, public.workspace_members, public.company_logos,
  public.spk_records, public.spk_sizes, public.spk_approvals, public.spk_design_files
  to authenticated;
grant insert, update, delete on public.company_logos to authenticated;
revoke all on public.spk_number_counters from anon, authenticated;

create or replace function public.create_workspace(p_name text)
returns public.workspaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_workspace public.workspaces;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 1 or char_length(btrim(p_name)) > 120 then
    raise exception 'Nama workspace harus 1-120 karakter.' using errcode = '22023';
  end if;

  insert into public.workspaces(name, created_by)
  values (btrim(p_name), v_user)
  returning * into v_workspace;

  insert into public.workspace_members(workspace_id, user_id, role, status)
  values (v_workspace.id, v_user, 'admin', 'active');

  return v_workspace;
end;
$$;

create or replace function public.add_workspace_member(p_workspace_id uuid, p_user_id uuid, p_role text default 'member')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not private.is_workspace_admin(p_workspace_id) then
    raise exception 'Hanya admin workspace yang dapat menambah anggota.' using errcode = '42501';
  end if;
  if p_role not in ('admin','member') then
    raise exception 'Role tidak valid.' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'Akun target belum terdaftar.' using errcode = '22023';
  end if;

  insert into public.workspace_members(workspace_id, user_id, role, status)
  values (p_workspace_id, p_user_id, p_role, 'active')
  on conflict (workspace_id, user_id) do update
    set role = excluded.role, status = 'active';
end;
$$;

create or replace function public.remove_workspace_member(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role text;
  v_admin_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not private.is_workspace_admin(p_workspace_id) then
    raise exception 'Hanya admin workspace yang dapat mengeluarkan anggota.' using errcode = '42501';
  end if;

  select role into v_target_role
  from public.workspace_members
  where workspace_id = p_workspace_id and user_id = p_user_id and status = 'active'
  for update;

  if not found then return; end if;

  if v_target_role = 'admin' then
    select count(*) into v_admin_count
    from public.workspace_members
    where workspace_id = p_workspace_id and role = 'admin' and status = 'active';
    if v_admin_count <= 1 then
      raise exception 'Workspace harus memiliki minimal satu admin aktif.' using errcode = '22023';
    end if;
  end if;

  update public.workspace_members
  set status = 'inactive'
  where workspace_id = p_workspace_id and user_id = p_user_id;
end;
$$;

create or replace function public.next_spk_number(p_workspace_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := (now() at time zone 'Asia/Jakarta')::date;
  v_seq integer;
begin
  if (select auth.uid()) is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace tidak dapat diakses oleh akun ini.' using errcode = '42501';
  end if;

  insert into public.spk_number_counters(workspace_id, counter_date, last_seq)
  values (p_workspace_id, v_date, 1)
  on conflict (workspace_id, counter_date) do update
    set last_seq = public.spk_number_counters.last_seq + 1
  returning last_seq into v_seq;

  return 'SPK-' || to_char(v_date, 'YYYYMMDD') || '-' || lpad(v_seq::text, 3, '0');
end;
$$;

create or replace function public.save_spk(p_payload jsonb)
returns public.spk_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
  v_workspace_id uuid;
  v_spk_no text;
  v_base_version integer;
  v_current public.spk_records;
  v_saved public.spk_records;
  v_sizes jsonb := coalesce(p_payload->'sizes', '[]'::jsonb);
  v_approvals jsonb := coalesce(p_payload->'approvals', '[]'::jsonb);
  v_quantity integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_payload), '') <> 'object' then
    raise exception 'Payload SPK tidak valid.' using errcode = '22023';
  end if;

  v_id := nullif(btrim(p_payload->>'id'), '');
  v_workspace_id := nullif(p_payload->>'workspace_id', '')::uuid;
  v_spk_no := nullif(btrim(p_payload->>'spk_no'), '');
  v_base_version := coalesce(nullif(p_payload->>'base_version', '')::integer, 0);

  if v_id is null or v_workspace_id is null or v_spk_no is null then
    raise exception 'ID, workspace, dan nomor SPK wajib diisi.' using errcode = '22023';
  end if;
  if not private.is_workspace_member(v_workspace_id) then
    raise exception 'Workspace tidak dapat diakses oleh akun ini.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_sizes) <> 'array' or jsonb_typeof(v_approvals) <> 'array' then
    raise exception 'Rincian ukuran atau approval tidak valid.' using errcode = '22023';
  end if;

  select coalesce(sum(greatest(coalesce(nullif(x->>'quantity','')::integer, 0), 0)), 0)::integer
  into v_quantity
  from jsonb_array_elements(v_sizes) as t(x);

  select * into v_current
  from public.spk_records
  where id = v_id and workspace_id = v_workspace_id
  for update;

  if found then
    if v_current.version <> v_base_version then
      raise exception 'SPK_CONFLICT: record berubah sejak terakhir dimuat.' using errcode = '40001';
    end if;
    update public.spk_records set
      spk_no = v_spk_no,
      version = v_current.version + 1,
      customer = left(coalesce(p_payload->>'customer',''), 200),
      order_name = left(coalesce(p_payload->>'order_name',''), 200),
      order_date = nullif(p_payload->>'order_date','')::date,
      deadline = nullif(p_payload->>'deadline','')::date,
      model_kerah = left(coalesce(p_payload->>'model_kerah',''), 200),
      material = left(coalesce(p_payload->>'material',''), 200),
      colour = left(coalesce(p_payload->>'colour',''), 200),
      quantity = v_quantity,
      notes = left(coalesce(p_payload->>'notes',''), 10000),
      ap_designer = left(coalesce(p_payload->>'ap_designer',''), 200),
      ap_cs = left(coalesce(p_payload->>'ap_cs',''), 200),
      ap_customer = left(coalesce(p_payload->>'ap_customer',''), 200),
      ap_production = left(coalesce(p_payload->>'ap_production',''), 200),
      selected_logo_id = nullif(p_payload->>'selected_logo_id',''),
      selected_logo_label = left(coalesce(p_payload->>'selected_logo_label',''), 200),
      selected_logo_storage_path = nullif(p_payload->>'selected_logo_storage_path',''),
      design_storage_path = nullif(p_payload->>'design_storage_path',''),
      design_file_name = left(coalesce(p_payload->>'design_file_name','design'), 255),
      design_mime_type = left(coalesce(p_payload->>'design_mime_type','image/jpeg'), 120),
      design_file_size = greatest(coalesce(nullif(p_payload->>'design_file_size','')::bigint, 1), 0),
      updated_at = now(),
      deleted_at = null
    where id = v_id and workspace_id = v_workspace_id
    returning * into v_saved;
  else
    insert into public.spk_records(
      id, workspace_id, spk_no, version, customer, order_name, order_date, deadline,
      model_kerah, material, colour, quantity, notes, ap_designer, ap_cs, ap_customer,
      ap_production, selected_logo_id, selected_logo_label, selected_logo_storage_path,
      design_storage_path, design_file_name, design_mime_type, design_file_size
    ) values (
      v_id, v_workspace_id, v_spk_no, 1,
      left(coalesce(p_payload->>'customer',''), 200),
      left(coalesce(p_payload->>'order_name',''), 200),
      nullif(p_payload->>'order_date','')::date,
      nullif(p_payload->>'deadline','')::date,
      left(coalesce(p_payload->>'model_kerah',''), 200),
      left(coalesce(p_payload->>'material',''), 200),
      left(coalesce(p_payload->>'colour',''), 200),
      v_quantity,
      left(coalesce(p_payload->>'notes',''), 10000),
      left(coalesce(p_payload->>'ap_designer',''), 200),
      left(coalesce(p_payload->>'ap_cs',''), 200),
      left(coalesce(p_payload->>'ap_customer',''), 200),
      left(coalesce(p_payload->>'ap_production',''), 200),
      nullif(p_payload->>'selected_logo_id',''),
      left(coalesce(p_payload->>'selected_logo_label',''), 200),
      nullif(p_payload->>'selected_logo_storage_path',''),
      nullif(p_payload->>'design_storage_path',''),
      left(coalesce(p_payload->>'design_file_name','design'), 255),
      left(coalesce(p_payload->>'design_mime_type','image/jpeg'), 120),
      greatest(coalesce(nullif(p_payload->>'design_file_size','')::bigint, 1), 0)
    ) returning * into v_saved;
  end if;

  delete from public.spk_sizes where spk_id = v_id;
  insert into public.spk_sizes(spk_id, category, size_label, quantity)
  select v_id,
    left(coalesce(nullif(x->>'category',''),'dewasa-pendek'), 80),
    left(coalesce(x->>'size',''), 80),
    greatest(coalesce(nullif(x->>'quantity','')::integer, 0), 0)
  from jsonb_array_elements(v_sizes) as t(x)
  where coalesce(x->>'size','') <> ''
  on conflict (spk_id, category, size_label) do update set quantity = excluded.quantity;

  delete from public.spk_approvals where spk_id = v_id;
  insert into public.spk_approvals(spk_id, approval_type, approver_name)
  select v_id, x->>'type', left(coalesce(x->>'name',''), 200)
  from jsonb_array_elements(v_approvals) as t(x)
  where x->>'type' in ('designer','cs','customer','production')
  on conflict (spk_id, approval_type) do update set approver_name = excluded.approver_name;

  delete from public.spk_design_files where spk_id = v_id;
  if v_saved.design_storage_path is not null then
    insert into public.spk_design_files(spk_id, file_size, mime_type, file_name, storage_path)
    values (v_id, v_saved.design_file_size, v_saved.design_mime_type, v_saved.design_file_name, v_saved.design_storage_path);
  end if;

  return v_saved;
end;
$$;

create or replace function public.delete_spk(p_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select workspace_id into v_workspace_id
  from public.spk_records where id = p_id and deleted_at is null;
  if v_workspace_id is null or not private.is_workspace_member(v_workspace_id) then
    raise exception 'SPK tidak ditemukan atau akses ditolak.' using errcode = '42501';
  end if;
  update public.spk_records
  set deleted_at = now(), updated_at = now(), version = version + 1
  where id = p_id and workspace_id = v_workspace_id and deleted_at is null;
end;
$$;

revoke all on function public.create_workspace(text) from public, anon;
revoke all on function public.add_workspace_member(uuid, uuid, text) from public, anon;
revoke all on function public.remove_workspace_member(uuid, uuid) from public, anon;
revoke all on function public.next_spk_number(uuid) from public, anon;
revoke all on function public.save_spk(jsonb) from public, anon;
revoke all on function public.delete_spk(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.add_workspace_member(uuid, uuid, text) to authenticated;
grant execute on function public.remove_workspace_member(uuid, uuid) to authenticated;
grant execute on function public.next_spk_number(uuid) to authenticated;
grant execute on function public.save_spk(jsonb) to authenticated;
grant execute on function public.delete_spk(text) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit)
values ('spk-files', 'spk-files', false, 15728640)
on conflict (id) do update set public = false, file_size_limit = 15728640;

drop policy if exists "workspace members can read SPK storage files" on storage.objects;
create policy "workspace members can read SPK storage files"
  on storage.objects for select to authenticated
  using (bucket_id = 'spk-files'
    and private.is_workspace_member(private.storage_workspace_id(name)));

drop policy if exists "workspace members can upload SPK design files and admins can upload logos" on storage.objects;
create policy "workspace members can upload SPK design files and admins can upload logos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'spk-files'
    and (
      (split_part(name, '/', 2) = 'spk'
        and private.is_workspace_member(private.storage_workspace_id(name)))
      or
      (split_part(name, '/', 2) = 'logos'
        and private.is_workspace_admin(private.storage_workspace_id(name)))
    ));

drop policy if exists "workspace admins can update company logo files" on storage.objects;
create policy "workspace admins can update company logo files"
  on storage.objects for update to authenticated
  using (bucket_id = 'spk-files'
    and split_part(name, '/', 2) = 'logos'
    and private.is_workspace_admin(private.storage_workspace_id(name)))
  with check (bucket_id = 'spk-files'
    and split_part(name, '/', 2) = 'logos'
    and private.is_workspace_admin(private.storage_workspace_id(name)));

drop policy if exists "workspace members can delete own workspace storage files" on storage.objects;
create policy "workspace members can delete own workspace storage files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'spk-files'
    and private.is_workspace_member(private.storage_workspace_id(name)));



-- Store delivery notes independently from production SPKs and accessory SPKs.
create table if not exists public.delivery_note_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  delivery_no text not null check (char_length(btrim(delivery_no)) between 1 and 64),
  version integer not null default 1 check (version > 0),
  business_type text not null default '' check (char_length(business_type) <= 200),
  business_address text not null default '' check (char_length(business_address) <= 500),
  business_whatsapp text not null default '' check (char_length(business_whatsapp) <= 80),
  logo_key text not null default '' check (logo_key in ('', 'venturo', 'unitee', 'forme', 'rytmo')),
  city text not null default '' check (char_length(city) <= 120),
  delivery_date date,
  recipient_name text not null default '' check (char_length(recipient_name) <= 200),
  recipient_address_1 text not null default '' check (char_length(recipient_address_1) <= 300),
  recipient_address_2 text not null default '' check (char_length(recipient_address_2) <= 300),
  items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50),
  total_quantity integer not null default 0 check (total_quantity >= 0),
  received_by text not null default '' check (char_length(received_by) <= 200),
  sender_name text not null default '' check (char_length(sender_name) <= 200),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, delivery_no)
);

create index if not exists delivery_note_records_workspace_updated_idx
  on public.delivery_note_records(workspace_id, updated_at desc)
  where deleted_at is null;

alter table public.delivery_note_records enable row level security;

drop policy if exists "workspace members can read delivery notes" on public.delivery_note_records;
create policy "workspace members can read delivery notes"
  on public.delivery_note_records
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

drop policy if exists "workspace members can create delivery notes" on public.delivery_note_records;
create policy "workspace members can create delivery notes"
  on public.delivery_note_records
  for insert to authenticated
  with check (
    private.is_workspace_member(workspace_id)
    and created_by = (select auth.uid())
  );

drop policy if exists "workspace members can update delivery notes" on public.delivery_note_records;
create policy "workspace members can update delivery notes"
  on public.delivery_note_records
  for update to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

revoke all on table public.delivery_note_records from public, anon;
grant select, insert, update on table public.delivery_note_records to authenticated;
revoke delete on table public.delivery_note_records from authenticated;

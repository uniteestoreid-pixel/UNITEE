alter table public.delivery_note_records
  add column if not exists logo_id text,
  add column if not exists logo_label text not null default '';

alter table public.delivery_note_records
  drop constraint if exists delivery_note_records_logo_label_check;
alter table public.delivery_note_records
  add constraint delivery_note_records_logo_label_check
  check (char_length(logo_label) <= 40);

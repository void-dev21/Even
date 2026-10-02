-- Run this once in your Supabase project's SQL Editor (Database > SQL Editor > New query).
-- This version adds real accounts (Supabase Auth) on top of the members/entries tables.

create extension if not exists pgcrypto;

-- Every row here is either a registered account (user_id set, created at signup)
-- or a "guest" someone added manually for a friend who doesn't want to sign up
-- (user_id null).
create table if not exists members (
  name text primary key,
  user_id uuid references auth.users(id) on delete cascade unique,
  added_by uuid references auth.users(id) default auth.uid(),
  added_at timestamptz default now()
);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  from_name text not null references members(name) on delete cascade,
  to_name text not null references members(name) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  note text default '',
  ts timestamptz default now(),
  added_by uuid references auth.users(id) default auth.uid(),
  added_by_name text default '',
  confirmed boolean default false,
  confirmed_by uuid references auth.users(id),
  confirmed_by_name text default '',
  edited_at timestamptz
);

create index if not exists entries_ts_idx on entries (ts desc);

alter table members enable row level security;
alter table entries enable row level security;

-- ---------- members ----------

drop policy if exists "members select" on members;
create policy "members select" on members
  for select using (auth.role() = 'authenticated');

-- You can register yourself, or add a guest (user_id left null) under your own name.
drop policy if exists "members insert" on members;
create policy "members insert" on members
  for insert with check (
    auth.role() = 'authenticated'
    and (user_id is null or user_id = auth.uid())
  );

-- You can only remove your own account, or a guest you personally added.
drop policy if exists "members delete" on members;
create policy "members delete" on members
  for delete using (
    user_id = auth.uid()
    or (user_id is null and added_by = auth.uid())
  );

-- ---------- entries ----------

drop policy if exists "entries select" on entries;
create policy "entries select" on entries
  for select using (auth.role() = 'authenticated');

drop policy if exists "entries insert" on entries;
create policy "entries insert" on entries
  for insert with check (added_by = auth.uid());

-- Any signed-in member can update a row (this is what lets someone else confirm
-- your entry). The trigger below stops that from being used to change the
-- amount, note, or parties on an entry that isn't yours.
drop policy if exists "entries update" on entries;
create policy "entries update" on entries
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Only the person who logged an entry can delete it.
drop policy if exists "entries delete" on entries;
create policy "entries delete" on entries
  for delete using (added_by = auth.uid());

-- Belt-and-suspenders: block edits to an entry's substance (amount/note/parties)
-- by anyone other than whoever added it, even though the UPDATE policy above is
-- permissive (it has to be, so other members can confirm the entry).
create or replace function enforce_entry_edit_rules()
returns trigger as $$
declare
  debtor_uid uuid;
begin
  if (new.amount is distinct from old.amount)
     or (new.note is distinct from old.note)
     or (new.from_name is distinct from old.from_name)
     or (new.to_name is distinct from old.to_name) then
    if old.added_by is distinct from auth.uid() then
      raise exception 'Only the person who added this entry can change its amount, note, or parties.';
    end if;
  end if;

  -- Only the person who owes the debt (from_name) can confirm or unconfirm it.
  if (new.confirmed is distinct from old.confirmed)
     or (new.confirmed_by is distinct from old.confirmed_by)
     or (new.confirmed_by_name is distinct from old.confirmed_by_name) then
    select user_id into debtor_uid from members where name = old.from_name;
    if debtor_uid is null or debtor_uid is distinct from auth.uid() then
      raise exception 'Only the person who owes this debt can confirm it.';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists entries_edit_guard on entries;
create trigger entries_edit_guard
  before update on entries
  for each row execute function enforce_entry_edit_rules();

-- Enables live sync: every connected browser gets pushed changes instantly.
alter publication supabase_realtime add table members;
alter publication supabase_realtime add table entries;

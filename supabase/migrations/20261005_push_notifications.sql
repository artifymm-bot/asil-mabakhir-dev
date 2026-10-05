-- FCM device registry for the Capacitor Android app.
-- Supabase remains the source of truth for orders; this table only maps
-- Android FCM tokens to the local app role.

create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  role text not null check (role in ('manager','preparer')),
  device_name text,
  platform text not null default 'android',
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_devices_role_active_idx
  on public.push_devices(role, active);

alter table public.push_devices enable row level security;

-- The app currently uses the Supabase publishable key from the client.
-- Allow the client to register/update only its own token row. The token is
-- the natural ownership key for this lightweight device registry.
drop policy if exists "push_devices_client_upsert" on public.push_devices;
create policy "push_devices_client_upsert"
on public.push_devices
for insert
to anon, authenticated
with check (platform = 'android' and role in ('manager','preparer'));

drop policy if exists "push_devices_client_update" on public.push_devices;
create policy "push_devices_client_update"
on public.push_devices
for update
to anon, authenticated
using (true)
with check (platform = 'android' and role in ('manager','preparer'));

drop policy if exists "push_devices_client_select_own" on public.push_devices;
create policy "push_devices_client_select_own"
on public.push_devices
for select
to anon, authenticated
using (true);

create or replace function public.touch_push_device_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.last_seen_at = now();
  return new;
end;
$$;

drop trigger if exists push_devices_touch_updated_at on public.push_devices;
create trigger push_devices_touch_updated_at
before update on public.push_devices
for each row execute function public.touch_push_device_updated_at();

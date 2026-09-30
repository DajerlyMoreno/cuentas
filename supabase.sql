-- Ejecutar una vez en Supabase > SQL Editor

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- un usuario pertenece a un solo hogar
create table if not exists public.household_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade
);

alter table public.households enable row level security;
alter table public.household_members enable row level security;

drop policy if exists "ver mi membresia" on public.household_members;
create policy "ver mi membresia" on public.household_members
  for select using (user_id = auth.uid());

drop policy if exists "ver mi hogar" on public.households;
create policy "ver mi hogar" on public.households
  for select using (exists (select 1 from public.household_members m
                            where m.household_id = households.id and m.user_id = auth.uid()));

drop policy if exists "editar mi hogar" on public.households;
create policy "editar mi hogar" on public.households
  for update using (exists (select 1 from public.household_members m
                            where m.household_id = households.id and m.user_id = auth.uid()));

-- Crear hogar (y unirse a él)
create or replace function public.create_household()
returns public.households
language plpgsql security definer set search_path = public as $$
declare h public.households;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  insert into households default values returning * into h;
  insert into household_members(user_id, household_id) values (auth.uid(), h.id);
  return h;
end $$;

-- Unirse a un hogar existente con su código
create or replace function public.join_household(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  select id into hid from households where code = lower(trim(p_code));
  if hid is null then raise exception 'código no válido'; end if;
  insert into household_members(user_id, household_id) values (auth.uid(), hid)
    on conflict (user_id) do update set household_id = excluded.household_id;
  return hid;
end $$;

revoke all on function public.create_household() from public, anon;
revoke all on function public.join_household(text) from public, anon;
grant execute on function public.create_household() to authenticated;
grant execute on function public.join_household(text) to authenticated;

-- Sincronización en tiempo real entre los dos dispositivos
alter publication supabase_realtime add table public.households;

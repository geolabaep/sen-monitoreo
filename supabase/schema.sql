-- GEOlab–SEN v27. Ejecutar una sola vez en el SQL Editor de Supabase.
-- NO publicar datos personales en GitHub Pages.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'pending' check (role in ('pending','admin','operator')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.create_profile_on_signup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
 insert into public.profiles (id,email,full_name,role,active)
 values (new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'full_name',''),'pending',false)
 on conflict (id) do nothing;
 return new;
end $$;
drop trigger if exists on_auth_user_created_sen on auth.users;
create trigger on_auth_user_created_sen after insert on auth.users for each row execute function public.create_profile_on_signup();

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','operator') and active=true)
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and active=true)
$$;
revoke all on function public.is_staff() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.events (
 id uuid primary key default gen_random_uuid(),
 expediente text not null unique,
 evento text not null default '',
 localidad text not null default '',
 zone_key text,
 estado text not null default 'recibido' check(estado in ('recibido','edan','completado')),
 recepcion date,
 details jsonb not null default '{}'::jsonb,
 created_by uuid references auth.users(id),
 updated_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint details_is_object check(jsonb_typeof(details)='object')
);
create index if not exists events_zone_idx on public.events(zone_key);
create index if not exists events_state_idx on public.events(estado);
create index if not exists events_reception_idx on public.events(recepcion);

create table if not exists public.event_audit (
 id bigint generated always as identity primary key,
 event_id uuid not null references public.events(id) on delete restrict,
 actor uuid references auth.users(id),
 action text not null check(action in ('creacion','actualizacion')),
 before_data jsonb,
 after_data jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists event_audit_event_idx on public.event_audit(event_id,created_at);

-- Tabla separada sin expedientes, nombres, notas, coordenadas ni descripciones.
create table if not exists public.public_event_zones (
 event_id uuid primary key references public.events(id) on delete cascade,
 zone_key text not null,
 estado text not null check(estado in ('recibido','edan','completado'))
);

create or replace function public.audit_event_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' then
   new.created_by:=auth.uid();new.updated_by:=auth.uid();
   new.created_at:=now();new.updated_at:=now();
   return new;
 end if;
 if new.id<>old.id or new.created_by is distinct from old.created_by or new.created_at<>old.created_at then
    raise exception 'No se pueden alterar campos de auditoría';
 end if;
 new.updated_by:=auth.uid();new.updated_at:=now();
 return new;
end $$;
drop trigger if exists before_events_sen on public.events;
create trigger before_events_sen before insert or update on public.events
for each row execute function public.audit_event_change();

create or replace function public.after_event_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' then
  insert into public.event_audit(event_id,actor,action,after_data)
  values(new.id,auth.uid(),'creacion',to_jsonb(new));
 else
  if (new.expediente,new.evento,new.localidad,new.zone_key,new.estado,new.recepcion,new.details)
   is distinct from (old.expediente,old.evento,old.localidad,old.zone_key,old.estado,old.recepcion,old.details) then
   insert into public.event_audit(event_id,actor,action,before_data,after_data)
   values(new.id,auth.uid(),'actualizacion',to_jsonb(old),to_jsonb(new));
  end if;
 end if;
 if new.zone_key is null or btrim(new.zone_key)='' then
   delete from public.public_event_zones where event_id=new.id;
 else
   insert into public.public_event_zones(event_id,zone_key,estado)
   values(new.id,new.zone_key,new.estado)
   on conflict(event_id) do update set zone_key=excluded.zone_key,estado=excluded.estado;
 end if;
 return null;
end $$;
drop trigger if exists after_events_sen on public.events;
create trigger after_events_sen after insert or update on public.events
for each row execute function public.after_event_change();

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_audit enable row level security;
alter table public.public_event_zones enable row level security;

drop policy if exists profiles_read_sen on public.profiles;
create policy profiles_read_sen on public.profiles for select to authenticated
 using (id=auth.uid() or public.is_staff());
-- No UPDATE/INSERT/DELETE de perfiles desde el navegador.

drop policy if exists events_read_sen on public.events;
create policy events_read_sen on public.events for select to authenticated using(public.is_staff());
drop policy if exists events_insert_sen on public.events;
create policy events_insert_sen on public.events for insert to authenticated with check(public.is_staff());
drop policy if exists events_update_sen on public.events;
create policy events_update_sen on public.events for update to authenticated
 using(public.is_staff()) with check(public.is_staff());
-- No borrar expedientes desde la aplicación, para proteger historial.

drop policy if exists audit_read_sen on public.event_audit;
create policy audit_read_sen on public.event_audit for select to authenticated using(public.is_staff());
-- La auditoría se registra exclusivamente mediante triggers.

drop policy if exists zones_public_read_sen on public.public_event_zones;
create policy zones_public_read_sen on public.public_event_zones for select to anon,authenticated using(true);

revoke all on public.profiles,public.events,public.event_audit,public.public_event_zones from anon,authenticated;
grant select on public.profiles to authenticated;
grant select,insert,update on public.events to authenticated;
grant select on public.event_audit to authenticated;
grant select(zone_key,estado) on public.public_event_zones to anon,authenticated;
-- No permisos para publicar identificadores de expedientes, eventos detallados o datos personales.

-- PRIMER ADMINISTRADOR, solo tras crear manualmente el usuario en Authentication > Users:
-- UPDATE public.profiles SET role='admin',active=true
-- WHERE email='correo-institucional-del-administrador@ejemplo.gov.py';
-- Verificar que actualiza exactamente una fila y desactivar Signups en Supabase Auth.

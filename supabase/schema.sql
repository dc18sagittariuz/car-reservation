-- =====================================================================
-- ระบบจองใช้รถภายในหน่วยงาน : โครงสร้างฐานข้อมูล Supabase
-- วิธีใช้: Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run
-- รันซ้ำได้ (idempotent) ไม่ลบข้อมูลเดิม
-- =====================================================================

create extension if not exists btree_gist;

-- ---------- ผู้ใช้ (ผูกกับ auth.users) ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text not null default '',
  dept       text not null default '',
  phone      text not null default '',
  role       text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

-- สร้างโปรไฟล์อัตโนมัติเมื่อมีคนสมัคร
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, dept, phone)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name',''),
          coalesce(new.raw_user_meta_data->>'dept',''),
          coalesce(new.raw_user_meta_data->>'phone',''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

-- ผู้ใช้ทั่วไปเปลี่ยน role ตัวเองไม่ได้
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() ว่าง = รันจาก SQL Editor / ฝั่งเซิร์ฟเวอร์ (อนุญาต)
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่เปลี่ยนสิทธิ์ได้';
  end if;
  new.id := old.id; new.email := old.email;
  return new;
end $$;
drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------- รถ ----------
create table if not exists public.vehicles (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('sedan','pickup','van')),
  name       text not null,
  plate      text not null default '',
  seats      int  not null default 4 check (seats between 1 and 60),
  active     boolean not null default true,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

insert into public.vehicles (kind, name, seats, sort)
select * from (values ('van','รถตู้',12,1), ('pickup','รถกระบะ',4,2), ('sedan','รถเก๋ง',4,3)) v(kind,name,seats,sort)
where not exists (select 1 from public.vehicles);

-- ---------- พนักงานขับรถ ----------
create table if not exists public.drivers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text not null default '',
  line_id    text not null default '',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- การจอง ----------
create table if not exists public.bookings (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles(id) on delete restrict,
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  requester   text not null,
  dept        text not null default '',
  phone       text not null default '',
  passengers  int  not null default 1 check (passengers >= 1),
  purpose     text not null default '',
  destination text not null default '',
  note        text not null default '',
  status      text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  driver_id   uuid references public.drivers(id) on delete set null,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid,
  constraint end_after_start check (end_at > start_at)
);

-- กันจองรถคันเดียวกันซ้อนเวลา (นับทั้งรออนุมัติและอนุมัติแล้ว)
do $$ begin
  alter table public.bookings add constraint no_vehicle_overlap
    exclude using gist (vehicle_id with =, tstzrange(start_at, end_at) with &&)
    where (status in ('pending','approved'));
exception when duplicate_object or duplicate_table then null; end $$;

-- กันจัดคนขับคนเดียวกันลงงานที่ทับเวลา
do $$ begin
  alter table public.bookings add constraint no_driver_overlap
    exclude using gist (driver_id with =, tstzrange(start_at, end_at) with &&)
    where (status = 'approved' and driver_id is not null);
exception when duplicate_object or duplicate_table then null; end $$;

create index if not exists bookings_start_idx on public.bookings (start_at);

-- ผู้ใช้ทั่วไปทำได้แค่ "ยกเลิกคำขอของตัวเองที่ยังรออนุมัติ"
create or replace function public.guard_booking_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then
    if new.status is distinct from old.status and new.status in ('approved','rejected') then
      new.decided_at := now(); new.decided_by := auth.uid();
    end if;
    return new;
  end if;
  if old.created_by = auth.uid() and old.status = 'pending' and new.status = 'cancelled' then
    new := old;
    new.status := 'cancelled';
    return new;
  end if;
  raise exception 'ไม่มีสิทธิ์แก้ไขการจองนี้';
end $$;
drop trigger if exists guard_booking_update on public.bookings;
create trigger guard_booking_update before update on public.bookings
  for each row execute function public.guard_booking_update();

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.drivers  enable row level security;
alter table public.bookings enable row level security;

drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles update" on public.profiles;
create policy "profiles read"   on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles update" on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists "vehicles read"  on public.vehicles;
drop policy if exists "vehicles admin" on public.vehicles;
create policy "vehicles read"  on public.vehicles for select to authenticated using (true);
create policy "vehicles admin" on public.vehicles for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "drivers read"  on public.drivers;
drop policy if exists "drivers admin" on public.drivers;
create policy "drivers read"  on public.drivers for select to authenticated using (true);
create policy "drivers admin" on public.drivers for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "bookings read"   on public.bookings;
drop policy if exists "bookings insert" on public.bookings;
drop policy if exists "bookings update" on public.bookings;
drop policy if exists "bookings delete" on public.bookings;
create policy "bookings read"   on public.bookings for select to authenticated using (true);
create policy "bookings insert" on public.bookings for insert to authenticated
  with check (created_by = auth.uid() and (status = 'pending' or public.is_admin()) and (driver_id is null or public.is_admin()));
create policy "bookings update" on public.bookings for update to authenticated
  using (public.is_admin() or (created_by = auth.uid() and status = 'pending'))
  with check (public.is_admin() or created_by = auth.uid());
create policy "bookings delete" on public.bookings for delete to authenticated using (public.is_admin());

-- ---------- Realtime (ให้ทุกหน้าจออัปเดตทันที) ----------
do $$ begin
  alter publication supabase_realtime add table public.bookings, public.drivers, public.vehicles;
exception when duplicate_object or duplicate_table then null; end $$;

-- ---------- Keep-alive สำหรับ GitHub Actions ----------
create or replace function public.keepalive()
returns timestamptz language sql security definer as $$ select now() $$;
revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

-- =====================================================================
-- ตั้งผู้ดูแลระบบคนแรก (สมัครผ่านหน้าเว็บก่อน แล้วรันบรรทัดนี้โดยแก้อีเมล):
-- update public.profiles set role = 'admin' where email = 'you@example.com';
-- =====================================================================

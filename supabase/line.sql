-- =====================================================================
-- ระบบแจ้งงานผ่าน LINE : ส่วนฐานข้อมูล
-- รันหลัง schema.sql  (SQL Editor → New query → วางทั้งไฟล์ → Run)
-- รันซ้ำได้ ไม่ลบข้อมูลเดิม
-- =====================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------- ตั้งค่า (มีแถวเดียว) ----------
create table if not exists public.line_settings (
  id                        int primary key default 1 check (id = 1),
  function_url              text not null default 'https://xoiisukhkvzinumzmvqf.supabase.co/functions/v1/line-bot',
  drivers_target            text,          -- groupId ของกลุ่มพนักงานขับรถ
  drivers_name              text,
  admin_target              text,          -- userId/groupId ที่รับแจ้งเตือนผู้ดูแล
  admin_name                text,
  pair_code                 text,
  pair_expires              timestamptz,
  daily_enabled             boolean not null default true,
  daily_hour                int not null default 17 check (daily_hour between 0 and 23),
  notify_changes            boolean not null default true,
  notify_cancel_admin       boolean not null default true,
  notify_new_request_admin  boolean not null default false,
  updated_at                timestamptz not null default now()
);
insert into public.line_settings (id) values (1) on conflict (id) do nothing;
-- คอลัมน์ที่เพิ่มภายหลัง
alter table public.line_settings add column if not exists weekly_enabled boolean not null default true;
alter table public.line_settings add column if not exists weekly_hour    int not null default 16;
alter table public.line_settings add column if not exists driver_token   text not null default replace(gen_random_uuid()::text, '-', '');
alter table public.line_settings add column if not exists site_url       text not null default 'https://dc18sagittariuz.github.io/car-reservation/';

-- ---------- คิวข้อความรอส่ง ----------
create table if not exists public.line_outbox (
  id         bigserial primary key,
  audience   text not null check (audience in ('drivers','admins')),
  body       text not null,
  status     text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  attempts   int  not null default 0,
  error      text,
  created_at timestamptz not null default now(),
  last_try   timestamptz,
  sent_at    timestamptz
);
create index if not exists line_outbox_status_idx on public.line_outbox (status, id);

alter table public.line_settings enable row level security;
alter table public.line_outbox   enable row level security;
drop policy if exists "line_settings admin read" on public.line_settings;
drop policy if exists "line_outbox admin read"   on public.line_outbox;
create policy "line_settings admin read" on public.line_settings for select to authenticated using (public.is_superadmin());
create policy "line_outbox admin read"   on public.line_outbox   for select to authenticated using (public.is_superadmin());

-- ---------- ข้อความภาษาไทย ----------
create or replace function public.line_thdate(ts timestamptz, long boolean default false)
returns text language sql stable as $$
  select case when long then
      'วัน' || (array['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'])[extract(dow from l)::int + 1]
      || 'ที่ ' || extract(day from l)::int || ' '
      || (array['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'])[extract(month from l)::int]
      || ' ' || (extract(year from l)::int + 543)
    else
      (array['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'])[extract(dow from l)::int + 1]
      || ' ' || extract(day from l)::int || ' '
      || (array['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'])[extract(month from l)::int]
    end
  from (select ts at time zone 'Asia/Bangkok' as l) x
$$;

create or replace function public.line_job_text(b public.bookings)
returns text language sql stable security definer set search_path = public as $$
  select concat_ws(E'\n',
    '🚗 ' || coalesce(v.name, 'รถ') || case when coalesce(v.plate,'') <> '' then ' (' || v.plate || ')' else '' end,
    '🕗 ' || case
       when (b.start_at at time zone 'Asia/Bangkok')::date = (b.end_at at time zone 'Asia/Bangkok')::date
         then line_thdate(b.start_at) || ' ' || to_char(b.start_at at time zone 'Asia/Bangkok','HH24:MI')
              || '–' || to_char(b.end_at at time zone 'Asia/Bangkok','HH24:MI') || ' น.'
       else line_thdate(b.start_at) || ' ' || to_char(b.start_at at time zone 'Asia/Bangkok','HH24:MI') || ' น. → '
            || line_thdate(b.end_at) || ' ' || to_char(b.end_at at time zone 'Asia/Bangkok','HH24:MI') || ' น.'
       end,
    '👤 คนขับ: ' || coalesce(d.name, 'ยังไม่จัด') || case when coalesce(d.phone,'') <> '' then ' (' || d.phone || ')' else '' end,
    '🙋 ผู้ขอ: ' || b.requester || case when b.dept <> '' then ' (' || b.dept || ')' else '' end
                 || case when b.phone <> '' then ' โทร ' || b.phone else '' end,
    '📍 ไปที่: ' || b.destination,
    '📝 ' || b.purpose || case when b.note <> '' then ' – ' || b.note else '' end || ' · ' || b.passengers || ' คน')
  from (select 1) one
  left join public.vehicles v on v.id = b.vehicle_id
  left join public.drivers  d on d.id = b.driver_id
$$;

create or replace function public.line_daily_text(d date)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  r  public.bookings;
  n  int := 0;
  nodrv int := 0;
  body text := '';
  ds timestamptz := (d::timestamp at time zone 'Asia/Bangkok');
  de timestamptz := ((d + 1)::timestamp at time zone 'Asia/Bangkok');
begin
  for r in select * from public.bookings where status = 'approved' and start_at < de and end_at > ds order by start_at loop
    n := n + 1;
    if r.driver_id is null then nodrv := nodrv + 1; end if;
    body := body || E'\n\n' || n || '. ' || line_job_text(r);
  end loop;
  return '📋 งานขับรถ ' || line_thdate(ds, true) || E'\n'
    || case when n = 0 then 'ไม่มีงาน'
            else 'รวม ' || n || ' งาน' || case when nodrv > 0 then ' (ยังไม่จัดคนขับ ' || nodrv || ' งาน)' else '' end || body end;
end $$;

create or replace function public.line_daily_text_rel(p_offset int)
returns text language sql stable security definer set search_path = public as $$
  select public.line_daily_text((now() at time zone 'Asia/Bangkok')::date + p_offset)
$$;

-- สรุปงานรายสัปดาห์ (จันทร์–อาทิตย์): แยกวันด้วยเส้นคั่น ข้อมูลงานละ 4 บรรทัด และเว้นบรรทัดระหว่างงาน
-- เวลาเขียนแบบ 9.00 น. (ไม่ใช่ 09:00) เพื่อไม่ให้ LINE แปลงเป็นลิงก์
create or replace function public.line_week_text(d_from date, p_title text default 'งานขับรถสัปดาห์')
returns text language plpgsql stable security definer set search_path = public as $$
declare
  ds timestamptz := (d_from::timestamp at time zone 'Asia/Bangkok');
  de timestamptz := ((d_from + 7)::timestamp at time zone 'Asia/Bangkok');
  d_to date := d_from + 6;
  mon text[] := array['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  dayn text[] := array['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  r record; cur date; n int := 0; nodrv int := 0; body text := ''; day_d date;
  ls timestamp; le timestamp; t_end text;
begin
  for r in
    select b.*, v.kind as vkind, v.name as vname, v.plate as vplate, d.name as dname
      from public.bookings b
      left join public.vehicles v on v.id = b.vehicle_id
      left join public.drivers  d on d.id = b.driver_id
     where b.status = 'approved' and b.start_at < de and b.end_at > ds
     order by b.start_at
  loop
    n := n + 1;
    if r.driver_id is null then nodrv := nodrv + 1; end if;
    ls := r.start_at at time zone 'Asia/Bangkok';
    le := r.end_at   at time zone 'Asia/Bangkok';
    day_d := greatest(ls::date, d_from);
    if cur is distinct from day_d then
      cur := day_d;
      body := body || E'\n\n━━━━━━━━━━\n🗓 ' || dayn[extract(dow from day_d)::int + 1] || ' '
        || extract(day from day_d)::int || ' ' || mon[extract(month from day_d)::int];
    end if;
    t_end := case when le::date = ls::date then to_char(le, 'FMHH24.MI') || ' น.'
                  else to_char(le, 'FMHH24.MI') || ' น. (' || extract(day from le)::int || ' ' || mon[extract(month from le)::int] || ')' end;
    body := body || E'\n\n'
      || case r.vkind when 'van' then '🚐 ' when 'pickup' then '🛻 ' else '🚗 ' end
      || coalesce(r.vname, 'รถ') || case when coalesce(r.vplate,'') <> '' then ' ' || r.vplate else '' end
      || ' · ' || to_char(ls, 'FMHH24.MI') || '–' || t_end
      || E'\n👤 ' || coalesce(r.dname, '⚠️ ยังไม่จัดคนขับ')
      || E'\n📍 ' || r.destination
      || E'\n🙋 ' || r.requester;
  end loop;
  return '🗓️ ' || p_title || E'\n'
    || extract(day from d_from)::int
    || case when extract(month from d_from) = extract(month from d_to) then ''
            else ' ' || mon[extract(month from d_from)::int] end
    || '–' || extract(day from d_to)::int || ' ' || mon[extract(month from d_to)::int] || ' ' || (extract(year from d_to)::int + 543)
    || ' · ' || case when n = 0 then 'ไม่มีงาน' else 'รวม ' || n || ' งาน' end
    || case when nodrv > 0 then E'\n⚠️ ยังไม่จัดคนขับ ' || nodrv || ' งาน' else '' end
    || body;
end $$;

-- p_weeks = 0 สัปดาห์นี้, 1 สัปดาห์หน้า
create or replace function public.line_week_text_rel(p_weeks int)
returns text language sql stable security definer set search_path = public as $$
  select public.line_week_text(
    date_trunc('week', (now() at time zone 'Asia/Bangkok'))::date + 7 * p_weeks,
    case when p_weeks = 0 then 'งานขับรถสัปดาห์นี้' else 'งานขับรถสัปดาห์หน้า' end)
$$;

-- ---------- ส่งข้อความเข้าคิว / ปลุก Edge Function ----------
create or replace function public.line_kick()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare u text;
begin
  select function_url into u from public.line_settings where id = 1;
  if u is null then return; end if;
  perform net.http_post(url := u, body := '{"action":"flush"}'::jsonb,
                        headers := '{"Content-Type":"application/json"}'::jsonb);
end $$;

create or replace function public.line_outbox_kick()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.line_kick(); return null; end $$;
drop trigger if exists line_outbox_kick on public.line_outbox;
create trigger line_outbox_kick after insert on public.line_outbox
  for each statement execute function public.line_outbox_kick();

create or replace function public.line_enqueue(p_audience text, p_body text)
returns void language sql security definer set search_path = public as $$
  insert into public.line_outbox (audience, body) values (p_audience, left(p_body, 20000))
$$;

-- สรุปงานพรุ่งนี้ (เรียกโดย pg_cron ทุกวัน)
create or replace function public.line_enqueue_daily()
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select daily_enabled from public.line_settings where id = 1) then
    perform public.line_enqueue('drivers', public.line_daily_text_rel(1));
  end if;
end $$;

-- สรุปงานสัปดาห์หน้า (เรียกโดย pg_cron ทุกวันศุกร์)
create or replace function public.line_enqueue_weekly()
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select weekly_enabled from public.line_settings where id = 1) then
    perform public.line_enqueue('drivers', public.line_week_text_rel(1));
  end if;
end $$;

-- ตั้งเวลา cron ใหม่ตามค่าที่ตั้งไว้ (pg_cron ใช้เวลา UTC, ไทย = UTC+7)
create or replace function public.line_reschedule()
returns void language plpgsql security definer set search_path = public as $$
declare s public.line_settings;
begin
  select * into s from public.line_settings where id = 1;
  perform cron.schedule('line-daily', format('0 %s * * *', (s.daily_hour - 7 + 24) % 24), 'select public.line_enqueue_daily()');
  -- วันศุกร์ (5) ตามเวลาไทย ถ้าก่อน 07:00 น. จะตรงกับวันพฤหัสบดี (4) ในเวลา UTC
  perform cron.schedule('line-weekly', format('0 %s * * %s', (s.weekly_hour - 7 + 24) % 24, case when s.weekly_hour < 7 then 4 else 5 end),
                        'select public.line_enqueue_weekly()');
end $$;

-- ส่งซ้ำข้อความที่ค้าง/ล้มเหลว (เรียกโดย pg_cron ทุก 15 นาที)
create or replace function public.line_retry()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.line_outbox set status = 'failed', error = 'หมดเวลา'
   where status = 'sending' and last_try < now() - interval '10 minutes';
  if exists (select 1 from public.line_outbox
              where status = 'pending' or (status = 'failed' and attempts < 3)) then
    perform public.line_kick();
  end if;
end $$;

-- Edge Function ดึงข้อความไปส่ง (เฉพาะ service role)
create or replace function public.line_claim_outbox()
returns table (id bigint, target text, body text)
language sql security definer set search_path = public as $$
  with s as (select drivers_target, admin_target from public.line_settings where id = 1),
  c as (
    select o.id from public.line_outbox o
     where o.status = 'pending'
        or (o.status = 'failed' and o.attempts < 3 and o.last_try < now() - interval '5 minutes')
     order by o.id limit 20
     for update skip locked
  )
  update public.line_outbox o
     set status   = case when (case o.audience when 'drivers' then s.drivers_target else s.admin_target end) is null
                         then 'skipped' else 'sending' end,
         error    = case when (case o.audience when 'drivers' then s.drivers_target else s.admin_target end) is null
                         then 'ยังไม่ได้เชื่อมกลุ่ม LINE' else null end,
         attempts = o.attempts + 1,
         last_try = now()
    from c, s
   where o.id = c.id
  returning o.id, case o.audience when 'drivers' then s.drivers_target else s.admin_target end, o.body
$$;

-- เชื่อมกลุ่ม/ผู้ใช้ LINE ด้วยรหัส 6 หลัก (เรียกจาก Edge Function)
create or replace function public.line_pair(p_code text, p_kind text, p_target text, p_name text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'drivers' then
    update public.line_settings set drivers_target = p_target, drivers_name = p_name, pair_code = null, pair_expires = null, updated_at = now()
     where id = 1 and pair_code = p_code and pair_expires > now();
  else
    update public.line_settings set admin_target = p_target, admin_name = p_name, pair_code = null, pair_expires = null, updated_at = now()
     where id = 1 and pair_code = p_code and pair_expires > now();
  end if;
  return found;
end $$;

-- ---------- RPC สำหรับหน้าเว็บ (เฉพาะ Super Admin) ----------
create or replace function public.line_new_pair_code()
returns text language plpgsql security definer set search_path = public as $$
declare c text := lpad((floor(random() * 1000000))::int::text, 6, '0');
begin
  if not public.is_superadmin() then raise exception 'เฉพาะ Super Admin'; end if;
  update public.line_settings set pair_code = c, pair_expires = now() + interval '30 minutes', updated_at = now() where id = 1;
  return c;
end $$;

create or replace function public.line_unlink(p_kind text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_superadmin() then raise exception 'เฉพาะ Super Admin'; end if;
  if p_kind = 'drivers' then update public.line_settings set drivers_target = null, drivers_name = null where id = 1;
  else update public.line_settings set admin_target = null, admin_name = null where id = 1; end if;
end $$;

drop function if exists public.line_save_settings(boolean,int,boolean,boolean,boolean);
create or replace function public.line_save_settings(
  p_daily_enabled boolean, p_daily_hour int, p_weekly_enabled boolean, p_weekly_hour int,
  p_notify_changes boolean, p_notify_cancel_admin boolean, p_notify_new_request_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_superadmin() then raise exception 'เฉพาะ Super Admin'; end if;
  update public.line_settings set daily_enabled = p_daily_enabled, daily_hour = p_daily_hour,
    weekly_enabled = p_weekly_enabled, weekly_hour = p_weekly_hour,
    notify_changes = p_notify_changes, notify_cancel_admin = p_notify_cancel_admin,
    notify_new_request_admin = p_notify_new_request_admin, updated_at = now()
   where id = 1;
  perform public.line_reschedule();
end $$;

-- สถิติการส่งเดือนนี้ (ใช้ประมาณโควตา)
create or replace function public.line_month_stats()
returns json language sql stable security definer set search_path = public as $$
  select case when public.is_superadmin() then json_build_object(
    'drivers_sent', count(*) filter (where audience = 'drivers' and status = 'sent'),
    'admins_sent',  count(*) filter (where audience = 'admins'  and status = 'sent'),
    'failed',       count(*) filter (where status = 'failed'),
    'month_start',  date_trunc('month', now() at time zone 'Asia/Bangkok'))
  else null end
  from public.line_outbox
  where sent_at >= (date_trunc('month', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok')
     or (status = 'failed' and created_at >= (date_trunc('month', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'))
$$;

-- ดูตัวอย่างข้อความก่อนส่ง (Super Admin)
create or replace function public.line_preview(p_what text)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_superadmin() then raise exception 'เฉพาะ Super Admin'; end if;
  return case p_what
    when 'today'    then public.line_daily_text_rel(0)
    when 'tomorrow' then public.line_daily_text_rel(1)
    when 'thisweek' then public.line_week_text_rel(0)
    when 'nextweek' then public.line_week_text_rel(1) end;
end $$;

-- ---------- ปฏิทินสำหรับพนักงานขับรถ (เปิดด้วยลิงก์ที่มีรหัส ไม่ต้องล็อกอิน) ----------
create or replace function public.driver_view(p_token text, p_from date, p_to date)
returns json language plpgsql stable security definer set search_path = public as $$
declare ds timestamptz; de timestamptz;
begin
  if p_token is null or not exists (select 1 from public.line_settings where id = 1 and driver_token = p_token) then
    raise exception 'invalid_token';
  end if;
  if p_to < p_from or p_to - p_from > 62 then raise exception 'ช่วงวันที่ไม่ถูกต้อง'; end if;
  ds := p_from::timestamp at time zone 'Asia/Bangkok';
  de := (p_to + 1)::timestamp at time zone 'Asia/Bangkok';
  return json_build_object(
    'drivers', coalesce((select json_agg(json_build_object('id', id, 'name', name, 'phone', phone) order by name)
                           from public.drivers where active), '[]'::json),
    'jobs', coalesce((select json_agg(json_build_object(
        'id', b.id, 'start_at', b.start_at, 'end_at', b.end_at,
        'kind', v.kind, 'vehicle', v.name, 'plate', v.plate,
        'driver_id', b.driver_id, 'driver', d.name, 'driver_phone', d.phone,
        'requester', b.requester, 'dept', b.dept, 'phone', b.phone,
        'destination', b.destination, 'purpose', b.purpose, 'note', b.note, 'passengers', b.passengers)
        order by b.start_at)
      from public.bookings b
      left join public.vehicles v on v.id = b.vehicle_id
      left join public.drivers  d on d.id = b.driver_id
      where b.status = 'approved' and b.start_at < de and b.end_at > ds), '[]'::json));
end $$;

-- ลิงก์ปฏิทินคนขับ (Admin ขึ้นไปดูได้) / สร้างลิงก์ใหม่ (Super Admin)
create or replace function public.driver_link()
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'เฉพาะผู้ดูแลระบบ'; end if;
  return (select site_url || 'driver.html?k=' || driver_token from public.line_settings where id = 1);
end $$;
create or replace function public.driver_link_reset()
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_superadmin() then raise exception 'เฉพาะ Super Admin'; end if;
  update public.line_settings set driver_token = replace(gen_random_uuid()::text, '-', ''), updated_at = now() where id = 1;
  return public.driver_link();
end $$;

create or replace function public.line_send_now(p_what text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_superadmin() then raise exception 'เฉพาะ Super Admin'; end if;
  if p_what = 'today'    then perform public.line_enqueue('drivers', public.line_daily_text_rel(0)); end if;
  if p_what = 'tomorrow' then perform public.line_enqueue('drivers', public.line_daily_text_rel(1)); end if;
  if p_what = 'thisweek' then perform public.line_enqueue('drivers', public.line_week_text_rel(0)); end if;
  if p_what = 'nextweek' then perform public.line_enqueue('drivers', public.line_week_text_rel(1)); end if;
  if p_what = 'test' then
    perform public.line_enqueue('drivers', '✅ ทดสอบการเชื่อมต่อ: กลุ่มนี้จะได้รับแจ้งงานขับรถจากระบบจองรถ');
    perform public.line_enqueue('admins',  '✅ ทดสอบการเชื่อมต่อ: แชทนี้จะได้รับแจ้งเตือนสำหรับผู้ดูแลระบบจองรถ');
  end if;
end $$;

-- ---------- แจ้งเตือนอัตโนมัติเมื่อการจองเปลี่ยน ----------
-- ส่งทันทีเฉพาะงานวันนี้ หรืองานพรุ่งนี้ที่สรุปประจำวันส่งไปแล้ว (ประหยัดโควตาข้อความ LINE)
create or replace function public.line_on_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s   public.line_settings;
  nb  timestamp := now() at time zone 'Asia/Bangkok';
  sd  date;
  soon boolean;
  hdr text;
begin
  select * into s from public.line_settings where id = 1;
  if not found then return null; end if;

  if tg_op = 'INSERT' then
    if new.status = 'pending' and s.notify_new_request_admin then
      perform line_enqueue('admins', '📝 คำขอใช้รถใหม่ รออนุมัติ' || E'\n' || line_job_text(new));
    end if;
    return null;
  end if;

  sd   := (new.start_at at time zone 'Asia/Bangkok')::date;
  soon := new.end_at > now() and (sd <= nb::date
          or (sd = nb::date + 1 and (not s.daily_enabled or extract(hour from nb) >= s.daily_hour)));

  -- อนุมัติ + จัดคนขับ / เปลี่ยนคนขับ
  if s.notify_changes and soon and new.status = 'approved' and new.driver_id is not null
     and (old.status <> 'approved' or old.driver_id is distinct from new.driver_id) then
    hdr := case when old.status = 'approved' and old.driver_id is not null then '🔄 เปลี่ยนคนขับ' else '🆕 งานใหม่' end;
    perform line_enqueue('drivers', hdr || E'\n' || line_job_text(new));
  end if;

  -- งานที่อนุมัติแล้วถูกยกเลิก
  if old.status = 'approved' and new.status in ('cancelled','rejected') then
    if s.notify_changes and soon then
      perform line_enqueue('drivers', '❌ ยกเลิกงาน' || E'\n' || line_job_text(old));
    end if;
    if s.notify_cancel_admin and new.status = 'cancelled' and new.cancelled_by is not distinct from old.created_by then
      perform line_enqueue('admins', '🔔 ผู้จองยกเลิกการจองที่อนุมัติแล้ว' || E'\n' || line_job_text(old)
        || case when new.cancel_reason <> '' then E'\n💬 เหตุผล: ' || new.cancel_reason else '' end);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists line_on_booking on public.bookings;
create trigger line_on_booking after insert or update on public.bookings
  for each row execute function public.line_on_booking();

-- ---------- สิทธิ์การเรียกใช้ฟังก์ชัน ----------
revoke all on function public.line_claim_outbox()                    from public, anon, authenticated;
revoke all on function public.line_pair(text,text,text,text)         from public, anon, authenticated;
revoke all on function public.line_daily_text_rel(int)               from public, anon, authenticated;
revoke all on function public.line_enqueue(text,text)                from public, anon, authenticated;
revoke all on function public.line_enqueue_daily()                   from public, anon, authenticated;
revoke all on function public.line_retry()                           from public, anon, authenticated;
revoke all on function public.line_kick()                            from public, anon, authenticated;
grant execute on function public.line_claim_outbox()                 to service_role;
grant execute on function public.line_pair(text,text,text,text)      to service_role;
grant execute on function public.line_daily_text_rel(int)            to service_role;
revoke all on function public.line_week_text_rel(int)                from public, anon, authenticated;
revoke all on function public.line_week_text(date,text)              from public, anon, authenticated;
revoke all on function public.line_enqueue_weekly()                  from public, anon, authenticated;
revoke all on function public.line_reschedule()                      from public, anon, authenticated;
grant execute on function public.line_week_text_rel(int)             to service_role;
grant execute on function public.line_month_stats()                  to authenticated;
grant execute on function public.line_preview(text)                  to authenticated;
grant execute on function public.driver_view(text,date,date)         to anon, authenticated;
grant execute on function public.driver_link()                       to authenticated;
grant execute on function public.driver_link_reset()                 to authenticated;
grant execute on function public.line_new_pair_code()                to authenticated;
grant execute on function public.line_unlink(text)                   to authenticated;
grant execute on function public.line_save_settings(boolean,int,boolean,int,boolean,boolean,boolean) to authenticated;
grant execute on function public.line_send_now(text)                 to authenticated;

-- ---------- งานตั้งเวลา (pg_cron ใช้เวลา UTC) ----------
select public.line_reschedule();
select cron.schedule('line-retry', '*/15 * * * *', 'select public.line_retry()');

-- ---------- Realtime ----------
do $$ begin
  alter publication supabase_realtime add table public.line_outbox, public.line_settings;
exception when duplicate_object or duplicate_table then null; end $$;

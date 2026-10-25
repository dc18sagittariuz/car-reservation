(function(){
'use strict';
const CFG = window.APP_CONFIG || {};
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);

const KIND = { van:'รถตู้', pickup:'รถกระบะ', sedan:'รถเก๋ง' };
const ROLE = { user:'ผู้ใช้ทั่วไป', admin:'Admin', superadmin:'Super Admin' };
const ST = { pending:'รออนุมัติ', approved:'อนุมัติแล้ว', rejected:'ไม่อนุมัติ', cancelled:'ยกเลิก' };
const PURPOSES = ['ประชุม / สัมมนา','ติดต่อราชการ','ลงพื้นที่ / ตรวจงาน','อบรม / ศึกษาดูงาน','รับ-ส่งเอกสาร / พัสดุ','รับ-ส่งบุคคล','อื่น ๆ'];
const S = { user:null, profile:null, isAdmin:false, isSuper:false, editId:null, pwOpen:null, pwShown:{}, recovering:false, vehicles:[], bookings:[], drivers:[], profiles:[], notifs:[], cancelOpen:null, line:{settings:null, outbox:[], status:null, code:null, codeExp:0, missing:false, dirty:false},
  mode:'month', cur:new Date(), filter:'pending', rMonth:null, view:'home', pickVeh:null, confirmDel:null, channel:null };

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2,'0');
const ymd = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const toLocal = iso => { const d=new Date(iso); return ymd(d)+'T'+pad(d.getHours())+':'+pad(d.getMinutes()); };
const toISO = local => new Date(local).toISOString();
const nowStr = () => toLocal(new Date());
const parseD = s => { const [y,m,d]=s.slice(0,10).split('-').map(Number); return new Date(y,m-1,d); };
const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const thDate = (s,opt) => parseD(s).toLocaleDateString('th-TH', opt || {weekday:'short',day:'numeric',month:'short',year:'2-digit'});
const tm = s => s.slice(11,16);
const mins = s => +s.slice(11,13)*60 + +s.slice(14,16);
const whenText = b => b.start.slice(0,10)===b.end.slice(0,10)
  ? `${thDate(b.start)} · ${tm(b.start)}–${tm(b.end)} น.`
  : `${thDate(b.start)} ${tm(b.start)} น. → ${thDate(b.end)} ${tm(b.end)} น.`;
const active = b => b.status==='pending' || b.status==='approved';
const overlaps = (a,b) => a.start < b.end && b.start < a.end;
const V = id => S.vehicles.find(v=>v.id===id) || {id, kind:'van', name:'(รถที่ถูกลบ)', plate:'', seats:0, active:false};
const vName = id => { const v=V(id); return v.name + (v.plate ? ` (${v.plate})` : ''); };
const vShort = id => { const v=V(id); return v.plate || v.name; };
const usable = () => S.vehicles.filter(v=>v.active);
const driverName = id => (S.drivers.find(d=>d.id===id)||{}).name || '';
function toast(msg){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,3000); }
async function copy(text){ try{ await navigator.clipboard.writeText(text); toast('คัดลอกแล้ว'); }catch(e){ toast('คัดลอกไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกเอง'); } }
function errText(e){
  const m = (e && (e.message||e.details)) || '';
  if (/no_vehicle_overlap/.test(m)) return 'รถคันนี้มีคนจองช่วงเวลานี้แล้ว';
  if (/no_driver_overlap/.test(m)) return 'พนักงานขับรถคนนี้มีงานอื่นที่ทับเวลานี้';
  if (/end_after_start/.test(m)) return 'เวลากลับต้องอยู่หลังเวลาออกเดินทาง';
  if (/[\u0E00-\u0E7F]/.test(m) && e && e.code==='P0001') return m;
  if (e && e.code==='42501' || /row-level security|ไม่มีสิทธิ์/.test(m)) return 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้';
  if (/foreign key|violates foreign/.test(m)) return 'ลบไม่ได้ เพราะมีการจองที่ใช้ข้อมูลนี้อยู่ ให้ตั้งเป็นงดใช้แทน';
  return m ? 'ทำรายการไม่สำเร็จ: '+m : 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง';
}

/* ---------- vehicle illustrations ---------- */
function vehArt(t){
  const wheel=x=>`<circle cx="${x}" cy="44" r="8.5" fill="var(--tire)"/><circle cx="${x}" cy="44" r="4" fill="var(--rim)"/>`;
  const sh=`<ellipse cx="60" cy="51.5" rx="55" ry="3.5" fill="var(--shadow)"/>`;
  const S2=`stroke="var(--car-line)" stroke-width="1.2"`;
  if(t==='sedan') return sh+`<path d="M6 38c0-5 3-8 8-9l18-2 12-10c2-2 5-3 9-3h23c4 0 7 1 10 4l10 9 12 2c5 1 7 4 7 8v4c0 2-1 3-3 3H8c-1 0-2-1-2-2z" fill="var(--car-body)" ${S2}/>
    <path d="M38 26l9-8c1-1 3-2 6-2h11v10z" fill="var(--glass)"/><path d="M67 16h9c3 0 5 1 7 3l7 7H67z" fill="var(--glass)"/>
    <path d="M65.5 27v14M8 35.5h105" ${S2} fill="none"/><path d="M10 35.5h101" stroke="var(--sedan)" stroke-width="1.6" opacity=".7"/>
    <rect x="7" y="31" width="6" height="2.6" rx="1.2" fill="var(--lamp)"/><rect x="110" y="31" width="4" height="2.6" rx="1.2" fill="var(--bad)"/>`+wheel(28)+wheel(92);
  if(t==='pickup') return sh+`<path d="M6 39c0-5 3-8 8-9l16-2 10-12c1-1 3-2 5-2h21c2 0 3 1 3 3v11h45v13c0 2-1 3-3 3H8c-1 0-2-1-2-2z" fill="var(--car-body)" ${S2}/>
    <path d="M34 27l8-10h11v10z" fill="var(--glass)"/><path d="M56 17h10v10H56z" fill="var(--glass)"/>
    <path d="M69 28v15M54.5 28v13M71 31.5h42" ${S2} fill="none"/><path d="M8 36h105" stroke="var(--pickup)" stroke-width="1.6" opacity=".7"/>
    <rect x="7" y="32" width="6" height="2.6" rx="1.2" fill="var(--lamp)"/><rect x="111" y="31" width="3" height="3" rx="1" fill="var(--bad)"/>`+wheel(26)+wheel(94);
  return sh+`<path d="M6 41V31c0-4 2-6 5-8l11-11c2-2 5-3 8-3h78c4 0 6 2 6 6v26c0 2-1 3-3 3H8c-1 0-2-1-2-2z" fill="var(--car-body)" ${S2}/>
    <path d="M12 24l11-11h9v11z" fill="var(--glass)"/><rect x="35" y="13" width="21" height="11" rx="1.5" fill="var(--glass)"/><rect x="59" y="13" width="21" height="11" rx="1.5" fill="var(--glass)"/><rect x="83" y="13" width="23" height="11" rx="1.5" fill="var(--glass)"/>
    <path d="M57.5 26v16M33.5 26v16" ${S2} fill="none"/><path d="M8 32.5h105" stroke="var(--van)" stroke-width="1.6" opacity=".7"/>
    <rect x="7" y="34" width="6" height="2.6" rx="1.2" fill="var(--lamp)"/><rect x="111" y="33" width="3" height="4" rx="1" fill="var(--bad)"/>`+wheel(26)+wheel(94);
}
const art = (kind,cls='art') => `<svg class="${cls}" viewBox="0 0 120 56" aria-hidden="true">${vehArt(kind)}</svg>`;

(function drawHero(){
  const tree=(x,y,r)=>`<rect x="${x-1.5}" y="${y}" width="3" height="${r+6}" fill="var(--tree2)"/><circle cx="${x}" cy="${y}" r="${r}" fill="var(--tree)"/><circle cx="${x+r*.45}" cy="${y+r*.3}" r="${r*.7}" fill="var(--tree2)" opacity=".8"/>`;
  const bld=(x,y,w,c)=>`<rect x="${x}" y="${y}" width="${w}" height="${140-y}" fill="var(${c})"/><rect x="${x+5}" y="${y+7}" width="${w-10}" height="${130-y-14}" fill="url(#win)"/>`;
  $('illus').innerHTML = `<defs><pattern id="win" width="10" height="12" patternUnits="userSpaceOnUse"><rect x="2" y="2" width="5" height="6" rx="1" fill="var(--bld-win)"/></pattern></defs>
    <g fill="var(--cloud)"><ellipse cx="60" cy="40" rx="22" ry="8"/><ellipse cx="74" cy="34" rx="13" ry="9"/><ellipse cx="300" cy="22" rx="24" ry="8"/><ellipse cx="314" cy="16" rx="13" ry="9"/><ellipse cx="38" cy="78" rx="14" ry="5"/></g>
    ${bld(140,52,46,'--bld')}${bld(190,26,40,'--bld2')}${bld(234,60,44,'--bld')}${bld(282,34,52,'--bld2')}${bld(338,70,38,'--bld')}${bld(380,16,40,'--bld2')}${bld(424,58,44,'--bld')}
    <path d="M40 140c60-14 400-16 480-2v12H40z" fill="var(--ground)"/>
    ${tree(106,108,13)}${tree(126,114,9)}${tree(452,106,14)}${tree(478,112,10)}${tree(500,110,12)}
    <g transform="translate(205 42) scale(1.78)">${vehArt('sedan')}</g>`;
})();

/* =====================================================================
   AUTH
   ===================================================================== */
let authMode='in';
function setAuthMode(m){
  authMode=m;
  $('authMode').hidden = m==='recover';
  $('authMode').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x.dataset.m===m));
  $('upFields').hidden = m!=='up';
  $('emailRow').hidden = m==='recover';
  $('passRow').hidden = m==='forgot';
  $('pass2Row').hidden = m!=='recover';
  $('forgotBtn').hidden = m!=='in';
  $('backBtn').hidden = m!=='forgot';
  $('authTitle').hidden = !(m==='forgot'||m==='recover');
  $('authTitle').textContent = m==='forgot' ? 'ลืมรหัสผ่าน' : 'ตั้งรหัสผ่านใหม่';
  $('passLbl').textContent = m==='recover' ? 'รหัสผ่านใหม่' : 'รหัสผ่าน';
  $('authBtn').textContent = {in:'เข้าสู่ระบบ',up:'สมัครใช้งาน',forgot:'ส่งลิงก์ตั้งรหัสผ่านใหม่',recover:'บันทึกรหัสผ่านใหม่'}[m];
  $('a-pass').autocomplete = (m==='up'||m==='recover') ? 'new-password' : 'current-password';
  $('authMsg').textContent=''; $('authMsg').className='auth-msg';
}
$('authMode').onclick=e=>{ const b=e.target.closest('button'); if(b) setAuthMode(b.dataset.m); };
$('forgotBtn').onclick=()=>setAuthMode('forgot');
$('backBtn').onclick=()=>setAuthMode('in');
$('authForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const msg=$('authMsg'), email=$('a-email').value.trim(), password=$('a-pass').value;
  msg.className='auth-msg';
  if(authMode==='forgot'){
    if(!email){ msg.className='auth-msg bad'; msg.textContent='กรุณากรอกอีเมลที่ใช้สมัคร'; return; }
    $('authBtn').disabled=true; msg.textContent='กำลังส่ง…';
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin+location.pathname });
    $('authBtn').disabled=false;
    if(error){ msg.className='auth-msg bad'; msg.textContent = /rate limit|seconds/i.test(error.message) ? 'ส่งอีเมลถี่เกินไป กรุณารอสักครู่แล้วลองใหม่ หรือติดต่อผู้ดูแลให้ตั้งรหัสใหม่ให้' : 'ส่งไม่สำเร็จ: '+error.message; return; }
    msg.className='auth-msg ok'; msg.textContent='ถ้ามีบัญชีนี้ในระบบ จะได้รับอีเมลพร้อมลิงก์ตั้งรหัสผ่านใหม่ (ดูในกล่องจดหมายขยะด้วย)';
    return;
  }
  if(authMode==='recover'){
    if(password.length<6){ msg.className='auth-msg bad'; msg.textContent='รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'; return; }
    if(password!==$('a-pass2').value){ msg.className='auth-msg bad'; msg.textContent='รหัสผ่านทั้งสองช่องไม่ตรงกัน'; return; }
    $('authBtn').disabled=true;
    const { error } = await sb.auth.updateUser({ password });
    $('authBtn').disabled=false;
    if(error){ msg.className='auth-msg bad'; msg.textContent='ไม่สำเร็จ: '+error.message; return; }
    S.recovering=false; RECOVERY_URL=false; $('a-pass').value=''; $('a-pass2').value='';
    try{ history.replaceState(null,'',location.pathname); }catch(e){}
    toast('ตั้งรหัสผ่านใหม่แล้ว'); setAuthMode('in');
    const { data:{ session } } = await sb.auth.getSession(); bootedFor=null; onSession(session);
    return;
  }
  if(!email || password.length<6){ msg.className='auth-msg bad'; msg.textContent='กรอกอีเมล และรหัสผ่านอย่างน้อย 6 ตัวอักษร'; return; }
  $('authBtn').disabled=true; msg.textContent='กำลังดำเนินการ…';
  try{
    if(authMode==='up'){
      const full_name=$('a-name').value.trim(), dept=$('a-dept').value.trim(), phone=$('a-phone').value.trim();
      if(!full_name){ msg.className='auth-msg bad'; msg.textContent='กรุณากรอกชื่อ-นามสกุล'; return; }
      const { data, error } = await sb.auth.signUp({ email, password, options:{ data:{full_name,dept,phone}, emailRedirectTo: location.origin+location.pathname } });
      if(error) throw error;
      if(!data.session){ msg.className='auth-msg ok'; msg.textContent='สมัครแล้ว กรุณาเปิดอีเมลเพื่อยืนยัน แล้วกลับมาเข้าสู่ระบบ'; }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if(error) throw error;
      msg.textContent='';
    }
  }catch(err){
    msg.className='auth-msg bad';
    const m=err.message||'';
    msg.textContent = /Invalid login/i.test(m) ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
      : /not confirmed/i.test(m) ? 'ยังไม่ได้ยืนยันอีเมล กรุณาเปิดลิงก์ในอีเมลก่อน'
      : /already registered/i.test(m) ? 'อีเมลนี้สมัครไว้แล้ว ลองเข้าสู่ระบบ'
      : 'ไม่สำเร็จ: '+m;
  }finally{ $('authBtn').disabled=false; }
});
$('logout').onclick=async()=>{ await sb.auth.signOut(); };
$('userchip').onclick=()=>go('prefs');

let RECOVERY_URL = /type=recovery/.test(location.hash+location.search);
sb.auth.onAuthStateChange((event, session)=>{
  if(event==='PASSWORD_RECOVERY') S.recovering=true;
  setTimeout(()=>onSession(session), 0);   // หลีกเลี่ยงการเรียก Supabase ภายใน callback โดยตรง
});

let bootedFor=null;
async function onSession(session){
  $('boot').hidden=true;
  if(!session){
    bootedFor=null; S.user=null; S.profile=null; S.isAdmin=false; S.isSuper=false;
    if(S.channel){ sb.removeChannel(S.channel); S.channel=null; }
    $('app').hidden=true; $('userchip').hidden=true; $('auth').hidden=false;
    return;
  }
  if(S.recovering || RECOVERY_URL){
    $('app').hidden=true; $('userchip').hidden=true; $('auth').hidden=false; setAuthMode('recover'); return;
  }
  if(bootedFor===session.user.id) return;
  bootedFor=session.user.id;
  S.user=session.user;
  $('auth').hidden=true; $('app').hidden=false; $('userchip').hidden=false;
  await loadProfile();
  await loadAll();
  subscribe();
  const h=(location.hash||'').slice(1); go(h||'home');
}

async function loadProfile(){
  const { data } = await sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle();
  S.profile = data || { id:S.user.id, email:S.user.email, full_name:'', dept:'', phone:'', role:'user' };
  S.isAdmin = ['admin','superadmin'].includes(S.profile.role);
  S.isSuper = S.profile.role==='superadmin';
  document.querySelectorAll('.admin-only').forEach(el=>el.hidden=!S.isAdmin);
  document.querySelectorAll('.super-only').forEach(el=>el.hidden=!S.isSuper);
  const p=S.profile;
  $('p-email').value=p.email||S.user.email||''; $('p-name').value=p.full_name||''; $('p-dept').value=p.dept||''; $('p-phone').value=p.phone||'';
  if(!$('f-name').value) $('f-name').value=p.full_name||'';
  if(!$('f-dept').value) $('f-dept').value=p.dept||'';
  if(!$('f-phone').value) $('f-phone').value=p.phone||'';
  renderHi();
}
function renderHi(){
  const p=S.profile||{};
  $('hi').innerHTML = `สวัสดี, <b>${p.full_name?'คุณ'+esc(p.full_name):'ผู้ใช้งาน'}</b><span>${esc(p.dept || S.user?.email || '')}${S.isAdmin?' · '+ROLE[p.role]:''}</span>`;
}

/* =====================================================================
   DATA
   ===================================================================== */
const mapBooking = r => ({ id:r.id, vehicle:r.vehicle_id, start:toLocal(r.start_at), end:toLocal(r.end_at), requester:r.requester, dept:r.dept,
  phone:r.phone, passengers:r.passengers, purpose:r.purpose, destination:r.destination, note:r.note, status:r.status, driverId:r.driver_id||'', by:r.created_by, cancelReason:r.cancel_reason||'', cancelledAt:r.cancelled_at });

async function loadVehicles(){
  const { data, error } = await sb.from('vehicles').select('*').order('sort').order('created_at');
  if(!error) S.vehicles=data||[];
  return error;
}
async function loadDrivers(){
  const { data, error } = await sb.from('drivers').select('*').order('name');
  if(!error) S.drivers=data||[];
  return error;
}
async function loadBookings(){
  const since = addDays(new Date(), -400).toISOString();
  const { data, error } = await sb.from('bookings').select('*').gte('end_at', since).order('start_at').limit(5000);
  if(!error) S.bookings=(data||[]).map(mapBooking);
  return error;
}
async function loadNotifs(){
  if(!S.isAdmin) return;
  const { data, error } = await sb.from('notifications').select('*').order('created_at',{ascending:false}).limit(100);
  if(!error) S.notifs=data||[];
}
async function loadLine(){
  if(!S.isSuper) return;
  const prev=S.line.settings;
  const { data, error } = await sb.from('line_settings').select('*').eq('id',1).maybeSingle();
  S.line.missing = !!error || !data;
  if(error) return;
  S.line.settings=data;
  if(prev && data){
    if(!prev.drivers_target && data.drivers_target){ toast('✅ เชื่อมกลุ่มคนขับ "'+(data.drivers_name||'')+'" แล้ว'); S.line.code=null; lineStatus(); }
    if(!prev.admin_target && data.admin_target){ toast('✅ เชื่อมแชทผู้ดูแล "'+(data.admin_name||'')+'" แล้ว'); S.line.code=null; }
  }
  const o = await sb.from('line_outbox').select('id,audience,body,status,error,created_at,sent_at').order('id',{ascending:false}).limit(20);
  if(!o.error) S.line.outbox=o.data||[];
  const st = await sb.rpc('line_month_stats'); if(!st.error) S.line.stats=st.data;
  if(S.view==='line') loadPreview();
}
async function loadDriverLink(){
  if(!S.isAdmin) return;
  const { data, error } = await sb.rpc('driver_link');
  S.driverLink = error ? null : data;
}
let previewT;
function loadPreview(){
  clearTimeout(previewT);
  previewT=setTimeout(async()=>{
    if(!S.isSuper || S.line.missing) return;
    const { data, error } = await sb.rpc('line_preview',{p_what:$('lineDay').value});
    $('lineMsg').textContent = error ? 'ดูตัวอย่างไม่ได้: '+errText(error) : (data||'');
  },150);
}
async function lineStatus(){
  if(!S.isSuper || S.line.missing) return;
  try{
    const { data:{ session } } = await sb.auth.getSession();
    const r = await fetch(CFG.SUPABASE_URL+'/functions/v1/line-bot', { method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey':CFG.SUPABASE_KEY, 'Authorization':'Bearer '+(session?session.access_token:'') },
      body: JSON.stringify({action:'status'}) });
    S.line.status = r.ok ? await r.json() : { fnError: r.status===401 ? 'ฟังก์ชัน line-bot ยังเปิด Verify JWT อยู่ หรือยังไม่ได้ deploy' : 'เรียกฟังก์ชัน line-bot ไม่สำเร็จ ('+r.status+')' };
  }catch(e){ S.line.status = { fnError:'ยังเรียกฟังก์ชัน line-bot ไม่ได้ ตรวจว่า deploy แล้ว' }; }
  renderLineAdmin();
}
async function loadProfiles(){
  if(!S.isAdmin) return;
  const { data } = await sb.from('profiles').select('*').order('full_name');
  S.profiles=data||[];
}
async function loadAll(){
  const errs=(await Promise.all([loadVehicles(),loadDrivers(),loadBookings(),loadProfiles(),loadNotifs(),loadLine(),loadDriverLink()])).filter(Boolean);
  const off=$('offline');
  if(errs.length){
    off.hidden=false;
    off.textContent = /relation .* does not exist|Could not find the table/i.test(errs[0].message||'')
      ? 'ยังไม่ได้สร้างตารางในฐานข้อมูล ให้ผู้ดูแลรันไฟล์ supabase/schema.sql ใน Supabase SQL Editor ก่อน'
      : 'โหลดข้อมูลไม่สำเร็จ: '+(errs[0].message||'');
  } else off.hidden=true;
  renderAll();
}
let reloadT={};
function reload(table){
  clearTimeout(reloadT[table]);
  reloadT[table]=setTimeout(async()=>{
    if(table==='bookings') await loadBookings();
    if(table==='drivers') await loadDrivers();
    if(table==='vehicles') await loadVehicles();
    if(table==='profiles') await loadProfiles();
    if(table==='notifications') await loadNotifs();
    if(table==='line') await loadLine();
    renderAll();
  },250);
}
function subscribe(){
  if(S.channel) sb.removeChannel(S.channel);
  S.channel = sb.channel('car-reservation')
    .on('postgres_changes',{event:'*',schema:'public',table:'bookings'},()=>reload('bookings'))
    .on('postgres_changes',{event:'*',schema:'public',table:'drivers'},()=>reload('drivers'))
    .on('postgres_changes',{event:'*',schema:'public',table:'vehicles'},()=>reload('vehicles'))
    .on('postgres_changes',{event:'*',schema:'public',table:'line_outbox'},()=>{ if(S.isSuper) reload('line'); })
    .on('postgres_changes',{event:'*',schema:'public',table:'line_settings'},()=>{ if(S.isSuper) reload('line'); })
    .on('postgres_changes',{event:'*',schema:'public',table:'notifications'},p=>{
      if(!S.isAdmin) return;
      if(p.eventType==='INSERT' && p.new && p.new.message) toast('🔔 '+p.new.message);
      reload('notifications'); })
    .subscribe();
}
// เผื่อ realtime หลุด: โหลดใหม่ทุก 2 นาที และเมื่อกลับมาที่แท็บ
setInterval(()=>{ if(S.user) loadAll(); }, 120000);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden && S.user) loadAll(); });

/* =====================================================================
   NAVIGATION
   ===================================================================== */
const VIEWS=['home','book','mine','cars','report','prefs','admin','notifs','drivers','users','line'];
const ADMIN_VIEWS=['admin','notifs','drivers','users'];
const SUPER_VIEWS=['line'];
function go(v){
  if(ADMIN_VIEWS.includes(v) && !S.isAdmin) v='home';
  if(SUPER_VIEWS.includes(v) && !S.isSuper) v='home';
  if(!VIEWS.includes(v)) v='home';
  S.view=v;
  document.querySelectorAll('.navbtn').forEach(b=>{ if(b.dataset.v===v) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  VIEWS.forEach(k=>$('v-'+k).hidden = k!==v);
  try{ history.replaceState(null,'','#'+v); }catch(e){}
  const nb=document.querySelector(`.navbtn[data-v="${v}"]`); if(nb && innerWidth<900) nb.scrollIntoView({block:'nearest',inline:'center'});
  window.scrollTo({top:0});
  if(v==='line' && S.isSuper){ S.line.dirty=false; renderLineAdmin(); lineStatus(); loadPreview(); }
}
$('nav').onclick=e=>{ const b=e.target.closest('.navbtn'); if(b) go(b.dataset.v); };
document.addEventListener('click',e=>{ const g=e.target.closest('[data-go]'); if(g) go(g.dataset.go); });

/* =====================================================================
   CALENDAR
   ===================================================================== */
function onDay(k){ const s=k+'T00:00', e=k+'T23:59'; return S.bookings.filter(b=>active(b) && b.start<=e && b.end>s).sort((a,b)=>a.start<b.start?-1:1); }
function renderCal(){
  const c=S.cur, today=ymd(new Date());
  document.querySelectorAll('#calMode button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===S.mode));
  if(S.mode==='month'){
    $('calTitle').textContent = c.toLocaleDateString('th-TH',{month:'long',year:'numeric'});
    const first=new Date(c.getFullYear(),c.getMonth(),1), start=addDays(first,-first.getDay());
    let h=['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'].map(d=>`<div class="dow">${d}</div>`).join('');
    for(let i=0;i<42;i++){
      const d=addDays(start,i); if(i===35 && d.getMonth()!==c.getMonth()) break;
      const k=ymd(d), list=onDay(k);
      h+=`<button class="day ${d.getMonth()!==c.getMonth()?'out':''} ${k===today?'today':''}" data-day="${k}" aria-label="${thDate(k,{day:'numeric',month:'long'})} มี ${list.length} รายการ">
        <span class="dnum">${d.getDate()}</span>
        ${list.slice(0,3).map(b=>`<span class="chip v-${V(b.vehicle).kind} ${b.status}" title="${esc(V(b.vehicle).name+' · '+b.requester+' · '+tm(b.start)+'–'+tm(b.end))}"><i></i><span>${esc(vShort(b.vehicle))}</span></span>`).join('')}
        ${list.length>3?`<span class="more">+${list.length-3} รายการ</span>`:''}
        <span class="dots">${list.map(b=>`<i class="v-${V(b.vehicle).kind}"></i>`).join('')}</span></button>`;
    }
    $('calBody').innerHTML=`<div class="cal">${h}</div>`;
  } else if(S.mode==='week'){
    const ws=addDays(c,-c.getDay()), we=addDays(ws,6);
    $('calTitle').textContent = `${ws.getDate()} ${ws.toLocaleDateString('th-TH',{month:'short'})} – ${we.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'})}`;
    let h='';
    for(let i=0;i<7;i++){
      const d=addDays(ws,i), k=ymd(d), list=onDay(k);
      h+=`<div class="wcol"><button class="whead ${k===today?'today':''}" data-day="${k}">${d.toLocaleDateString('th-TH',{weekday:'short'})}<b>${d.getDate()}</b></button><div class="wbody">
        ${list.map(b=>`<div class="wjob v-${V(b.vehicle).kind} ${b.status}"><b>${b.start.slice(0,10)===k?tm(b.start):'ต่อเนื่อง'}–${b.end.slice(0,10)===k?tm(b.end):'…'}</b>${esc(vShort(b.vehicle))}<br><span class="muted">${esc(b.requester)}</span></div>`).join('') || '<span class="small muted" style="text-align:center;padding:8px 0">ว่าง</span>'}
      </div></div>`;
    }
    $('calBody').innerHTML=`<div class="week-scroll"><div class="week">${h}</div></div>`;
  } else {
    const k=ymd(c), list=onDay(k);
    $('calTitle').textContent = c.toLocaleDateString('th-TH',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const H0=6*60, H1=21*60, span=H1-H0;
    let hours=''; for(let h=6;h<=21;h+=3) hours+=`<span style="left:${(h*60-H0)/span*100}%">${pad(h)}:00</span>`;
    const lanes=S.vehicles.map(v=>{
      const blocks=list.filter(b=>b.vehicle===v.id).map(b=>{
        let s=b.start.slice(0,10)<k?0:mins(b.start), e=b.end.slice(0,10)>k?1440:mins(b.end);
        s=Math.max(s,H0); e=Math.min(e,H1); if(e<=s) return '';
        return `<div class="blk ${b.status}" style="left:${(s-H0)/span*100}%;width:${(e-s)/span*100}%" title="${esc(b.requester+' · '+b.destination)}">${tm(b.start)} ${esc(b.requester)}</div>`;
      }).join('');
      return `<div class="lane v-${v.kind}"><div class="ln"><i></i>${esc(v.plate||v.name)}</div><div class="track">${blocks}</div></div>`;
    }).join('');
    $('calBody').innerHTML = `<div class="lanes"><div class="hours"><div></div><div>${hours}</div></div>${lanes}</div>
      <h3 style="margin:22px 0 12px">รายละเอียด ${list.length} รายการ</h3>
      <div class="list">${list.length?list.map(b=>card(b,'view')).join(''):'<div class="empty">ไม่มีการจองรถในวันนี้ รถทุกคันว่าง</div>'}</div>`;
  }
  $('calBody').querySelectorAll('[data-day]').forEach(el=>el.onclick=()=>{ S.cur=parseD(el.dataset.day); S.mode='day'; renderCal(); });
  $('legend').innerHTML = S.vehicles.map(v=>`<span class="v-${v.kind}"><i></i>${esc(vName(v.id))}</span>`).join('') + `<span class="pend"><i></i>กรอบเส้น = รออนุมัติ</span>`;
}
$('calMode').onclick=e=>{ const b=e.target.closest('button'); if(!b) return; S.mode=b.dataset.m; renderCal(); };
function shift(n){ const c=S.cur; S.cur = S.mode==='month'? new Date(c.getFullYear(),c.getMonth()+n,1) : addDays(c, n*(S.mode==='week'?7:1)); renderCal(); }
$('prev').onclick=()=>shift(-1); $('next').onclick=()=>shift(1);
$('todayBtn').onclick=()=>{ S.cur=new Date(); renderCal(); };

/* =====================================================================
   QUICK BOOKING + FLEET
   ===================================================================== */
(function initQuick(){
  let o=''; for(let h=6;h<=21;h++) for(const m of [0,30]){ if(h===21&&m) continue; o+=`<option>${pad(h)}:${pad(m)}</option>`; }
  $('q-st').innerHTML=o; $('q-et').innerHTML=o; $('q-st').value='08:00'; $('q-et').value='17:00';
  const po='<option value="">เลือกวัตถุประสงค์</option>'+PURPOSES.map(p=>`<option>${p}</option>`).join('');
  $('q-purpose').innerHTML=po; $('f-purpose').innerHTML=po;
  $('q-date').value=ymd(addDays(new Date(),1));
  const t=ymd(addDays(new Date(),1));
  $('f-sdate').value=t; $('f-edate').value=t; $('f-stime').value='08:00'; $('f-etime').value='17:00';
})();
$('quick').addEventListener('submit',e=>{
  e.preventDefault();
  const d=$('q-date').value, st=$('q-st').value, et=$('q-et').value, box=$('qResult');
  if(!d){ box.innerHTML='<div class="check bad">กรุณาเลือกวันที่ใช้งาน</div>'; return; }
  if(et<=st){ box.innerHTML='<div class="check bad">เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม</div>'; return; }
  const slot={start:d+'T'+st,end:d+'T'+et};
  if(slot.start<nowStr()){ box.innerHTML='<div class="check bad">ช่วงเวลานี้ผ่านไปแล้ว กรุณาเลือกใหม่</div>'; return; }
  box.innerHTML = `<div class="small muted">ผลการค้นหา ${thDate(d)} · ${st}–${et} น.</div>` + S.vehicles.map(v=>{
    const clash=S.bookings.find(b=>active(b)&&b.vehicle===v.id&&overlaps(b,slot));
    const ok=v.active&&!clash;
    const stt = !v.active ? `<span class="dotst" style="color:var(--bad)">งดใช้ชั่วคราว</span>` : clash ? `<span class="dotst" style="color:var(--bad)">ไม่ว่าง · ${esc(clash.requester)} ${tm(clash.start)}–${tm(clash.end)}</span>` : `<span class="dotst" style="color:var(--ok)">ว่าง</span>`;
    return `<div class="avail v-${v.kind}">${art(v.kind)}<div style="min-width:0"><b>${esc(vName(v.id))}</b><div class="st">${stt}</div></div>
      <button class="btn sm ${ok?'primary':''}" data-pick="${v.id}" ${ok?'':'disabled'}>จองคันนี้</button></div>`;
  }).join('');
  box.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{
    prefill({vehicle:b.dataset.pick, sdate:d, edate:d, st, et, purpose:$('q-purpose').value}); go('book');
  });
});
function carStatus(v){
  const n=nowStr();
  if(!v.active) return {txt:'งดใช้ / ซ่อมบำรุง',col:'var(--bad)'};
  const inUse=S.bookings.find(b=>b.vehicle===v.id&&b.status==='approved'&&b.start<=n&&n<b.end);
  return inUse ? {txt:`กำลังใช้งาน ถึง ${tm(inUse.end)} น.`,col:'var(--warn)'} : {txt:'ว่าง',col:'var(--ok)'};
}
function renderFleet(){
  $('fleet').innerHTML = S.vehicles.length ? S.vehicles.map(v=>{ const s=carStatus(v);
    return `<button class="fcar v-${v.kind}" data-car="${v.id}"><span class="pic">${art(v.kind)}</span><span style="min-width:0"><h3>${esc(vName(v.id))}</h3>
      <span class="seats"><svg class="i"><use href="#ic-user"/></svg>${+v.seats} ที่นั่ง · <span class="dotst" style="color:${s.col}">${s.txt}</span></span></span>
      <svg class="i chev"><use href="#ic-right"/></svg></button>`; }).join('') : '<div class="empty">ยังไม่มีข้อมูลรถ</div>';
  $('fleet').querySelectorAll('[data-car]').forEach(b=>b.onclick=()=>{ go('cars'); const el=$('car-'+b.dataset.car); if(el){ el.scrollIntoView({block:'center'}); el.classList.add('flash'); setTimeout(()=>el.classList.remove('flash'),1400); } });
}

/* =====================================================================
   BOOKING FORM
   ===================================================================== */
function renderVPick(){
  const cur=(document.querySelector('input[name=veh]:checked')||{}).value || S.pickVeh || (usable()[0]||{}).id;
  $('vpick').innerHTML = S.vehicles.map(v=>`<label class="v-${v.kind}"><input type="radio" name="veh" value="${v.id}" ${v.id===cur&&v.active?'checked':''} ${v.active?'':'disabled'}>
      <span class="opt">${art(v.kind)}<b>${esc(v.name)}</b><small>${v.active?esc(v.plate||KIND[v.kind]):'งดใช้ชั่วคราว'} · ${+v.seats} ที่นั่ง</small></span></label>`).join('')
      || '<div class="empty">ยังไม่มีข้อมูลรถ</div>';
  $('vpick').querySelectorAll('input').forEach(i=>i.onchange=()=>{ S.pickVeh=i.value; checkAvail(); renderQueue(); });
  checkAvail(); renderQueue();
}
function prefill(o){
  S.pickVeh=o.vehicle; $('f-sdate').value=o.sdate; $('f-edate').value=o.edate; $('f-stime').value=o.st; $('f-etime').value=o.et;
  if(o.purpose) $('f-purpose').value=o.purpose;
  const r=document.querySelector(`input[name=veh][value="${o.vehicle}"]`); if(r) r.checked=true;
  renderVPick();
}
function formSlot(){
  const v=(document.querySelector('input[name=veh]:checked')||{}).value;
  const sd=$('f-sdate').value, st=$('f-stime').value, ed=$('f-edate').value, et=$('f-etime').value;
  if(!v||!sd||!st||!ed||!et) return null;
  return {vehicle:v,start:sd+'T'+st,end:ed+'T'+et};
}
function checkAvail(){
  const box=$('avail'), s=formSlot();
  if(!s){ box.hidden=true; return true; }
  box.hidden=false;
  if(s.end<=s.start){ box.className='check bad'; box.textContent='เวลากลับต้องอยู่หลังเวลาออกเดินทาง'; return false; }
  if(s.start<nowStr()){ box.className='check bad'; box.textContent='เวลาออกเดินทางผ่านไปแล้ว กรุณาเลือกเวลาใหม่'; return false; }
  const clash=S.bookings.filter(b=>active(b)&&b.vehicle===s.vehicle&&overlaps(b,s));
  if(clash.length){ box.className='check bad'; box.innerHTML=`${esc(V(s.vehicle).name)}ไม่ว่างช่วงนี้ มีผู้จองแล้ว: `+clash.map(b=>`${esc(b.requester)} (${tm(b.start)}–${tm(b.end)} น.)`).join(', '); return false; }
  const others=usable().filter(v=>v.id!==s.vehicle&&!S.bookings.some(b=>active(b)&&b.vehicle===v.id&&overlaps(b,s)));
  box.className='check ok'; box.textContent=`${V(s.vehicle).name}ว่างในช่วงเวลานี้`+(others.length?` · คันอื่นที่ว่าง: ${others.map(v=>v.name).join(', ')}`:'');
  return true;
}
function renderQueue(){
  const id=(document.querySelector('input[name=veh]:checked')||{}).value, n=nowStr();
  if(!id){ $('queueTitle').textContent='คิวรถ'; $('queueList').innerHTML='<div class="empty">เลือกรถเพื่อดูคิว</div>'; return; }
  $('queueTitle').textContent='คิว'+vName(id);
  const q=S.bookings.filter(b=>active(b)&&b.vehicle===id&&b.end>n).sort((a,b)=>a.start<b.start?-1:1).slice(0,8);
  $('queueList').innerHTML = q.length ? q.map(b=>card(b,'view')).join('') : `<div class="empty">ยังไม่มีคิวจองของ${esc(V(id).name)} เลือกเวลาได้ตามสะดวก</div>`;
}
['f-sdate','f-stime','f-edate','f-etime'].forEach(id=>$(id).addEventListener('change',()=>{
  if(id==='f-sdate' && (!$('f-edate').value||$('f-edate').value<$('f-sdate').value)) $('f-edate').value=$('f-sdate').value;
  checkAvail();
}));
$('bookForm').addEventListener('submit', async e=>{
  e.preventDefault(); const msg=$('formMsg');
  const s=formSlot();
  if(!s){ msg.textContent='กรุณาเลือกรถ วันและเวลาให้ครบ'; return; }
  const req=['f-name','f-dept','f-phone','f-purpose','f-dest'].find(id=>!$(id).value.trim());
  if(req){ msg.textContent='กรุณากรอกข้อมูลให้ครบทุกช่อง'; $(req).focus(); return; }
  if(!checkAvail()){ msg.textContent='ช่วงเวลานี้จองไม่ได้ ดูรายละเอียดด้านบน'; return; }
  const pax=+$('f-pax').value||1;
  if(pax>V(s.vehicle).seats){ msg.textContent=`${V(s.vehicle).name}รับได้ไม่เกิน ${V(s.vehicle).seats} คน`; return; }
  $('submitBtn').disabled=true; msg.textContent='กำลังส่ง…';
  const { error } = await sb.from('bookings').insert({
    vehicle_id:s.vehicle, start_at:toISO(s.start), end_at:toISO(s.end),
    requester:$('f-name').value.trim(), dept:$('f-dept').value.trim(), phone:$('f-phone').value.trim(),
    passengers:pax, destination:$('f-dest').value.trim(), purpose:$('f-purpose').value, note:$('f-note').value.trim(),
    status:'pending', created_by:S.user.id });
  $('submitBtn').disabled=false;
  if(error){ msg.textContent=errText(error); return; }
  $('f-dest').value=''; $('f-note').value=''; $('f-pax').value=1; msg.textContent='';
  toast('ส่งคำขอแล้ว รอเจ้าหน้าที่อนุมัติ'); await loadBookings(); renderAll(); go('mine');
});

/* =====================================================================
   CARDS / LISTS
   ===================================================================== */
function card(b,mode){
  const drv=driverName(b.driverId), kind=V(b.vehicle).kind; let actions='';
  const canCancel = b.status==='pending' || (b.status==='approved' && b.start>nowStr());
  if(mode==='mine' && canCancel){
    const label = b.status==='approved' ? 'ยกเลิกการจอง' : 'ยกเลิกคำขอ';
    actions = S.cancelOpen===b.id
      ? `<div class="bk-actions cancel-box"><input id="cr-${b.id}" maxlength="300" placeholder="เหตุผลที่ยกเลิก (ไม่บังคับ)" aria-label="เหตุผลที่ยกเลิก">
          <button class="btn sm danger" data-act="cancel" data-id="${b.id}">ยืนยัน${label}</button><button class="btn sm" data-act="cancel-close" data-id="${b.id}">ไม่ยกเลิก</button></div>
         ${b.status==='approved'?'<div class="small muted">ระบบจะยกเลิกทันที และแจ้งเตือนผู้ดูแลระบบให้อัตโนมัติ</div>':''}`
      : `<div class="bk-actions"><button class="btn sm danger" data-act="cancel-open" data-id="${b.id}">${label}</button></div>`;
  }
  if(mode==='admin'){
    const busy=new Set(S.bookings.filter(x=>x.id!==b.id&&x.status==='approved'&&x.driverId&&overlaps(x,b)).map(x=>x.driverId));
    const opts=`<option value="">— เลือกพนักงานขับรถ —</option>`+S.drivers.filter(d=>d.active||d.id===b.driverId).map(d=>`<option value="${d.id}" ${d.id===b.driverId?'selected':''} ${busy.has(d.id)&&d.id!==b.driverId?'disabled':''}>${esc(d.name)}${busy.has(d.id)?' (ติดงานอื่นช่วงนี้)':''}</option>`).join('');
    const closed=b.status==='rejected'||b.status==='cancelled';
    actions=`<div class="bk-actions">
      ${closed?'':`<select data-act="driver" data-id="${b.id}" aria-label="จัดคนขับ">${opts}</select>`}
      ${b.status==='pending'?`<button class="btn sm good" data-act="approve" data-id="${b.id}">อนุมัติ</button><button class="btn sm danger" data-act="reject" data-id="${b.id}">ไม่อนุมัติ</button>`:''}
      ${b.status==='approved'?`<button class="btn sm" data-act="copy" data-id="${b.id}">คัดลอกข้อความแจ้งงาน</button><button class="btn sm danger" data-act="revoke" data-id="${b.id}">ยกเลิกงาน</button>`:''}
      ${closed?`<button class="btn sm" data-act="reopen" data-id="${b.id}">นำกลับมาพิจารณา</button>`:''}
      <span style="flex:1"></span>
      <button class="btn sm" data-act="edit-open" data-id="${b.id}">แก้ไข</button>
      <button class="btn sm danger" data-act="delbk" data-id="${b.id}">${S.confirmDel==='del-'+b.id?'ยืนยันลบถาวร':'ลบ'}</button>
    </div>`;
    if(S.editId===b.id) actions = editForm(b);
  }
  return `<div class="bk v-${kind}">
    <div class="bk-top"><div class="bk-title"><span class="vtag">${esc(vShort(b.vehicle))}</span>${esc(b.destination)}</div><span class="pill st-${b.status}">${ST[b.status]||esc(b.status)}</span></div>
    <div class="when">${whenText(b)}</div>
    <dl><dt>ผู้ขอ</dt><dd>${esc(b.requester)} · ${esc(b.dept)}${mode==='admin'?` · ${esc(b.phone)}`:''}</dd>
      <dt>ภารกิจ</dt><dd>${esc(b.purpose)}${b.note?' – '+esc(b.note):''} (${+b.passengers||1} คน)</dd>
      <dt>คนขับ</dt><dd>${drv?esc(drv):'<span class="muted">ยังไม่จัด</span>'}</dd>
      ${b.status==='cancelled'&&b.cancelReason?`<dt>เหตุผลยกเลิก</dt><dd>${esc(b.cancelReason)}</dd>`:''}</dl>${actions}</div>`;
}
function editForm(b){
  const vopts=S.vehicles.map(v=>`<option value="${v.id}" ${v.id===b.vehicle?'selected':''}>${esc(vName(v.id))}${v.active?'':' (งดใช้)'}</option>`).join('');
  const popts=[...new Set([...PURPOSES,b.purpose])].filter(Boolean).map(x=>`<option ${x===b.purpose?'selected':''}>${esc(x)}</option>`).join('');
  return `<div class="edit-box">
    <div class="row"><label>รถ<select id="e-veh">${vopts}</select></label><label>จำนวนผู้โดยสาร<input id="e-pax" type="number" min="1" max="60" value="${+b.passengers||1}"></label></div>
    <div class="row"><label>วันที่ออก<input id="e-sd" type="date" value="${b.start.slice(0,10)}"></label><label>เวลาออก<input id="e-st" type="time" step="900" value="${tm(b.start)}"></label></div>
    <div class="row"><label>วันที่กลับ<input id="e-ed" type="date" value="${b.end.slice(0,10)}"></label><label>เวลากลับ<input id="e-et" type="time" step="900" value="${tm(b.end)}"></label></div>
    <div class="row"><label>ผู้ขอ<input id="e-req" value="${esc(b.requester)}"></label><label>ฝ่าย<input id="e-dept" value="${esc(b.dept)}"></label></div>
    <div class="row"><label>เบอร์ติดต่อ<input id="e-phone" value="${esc(b.phone)}"></label><label>วัตถุประสงค์<select id="e-purpose">${popts}</select></label></div>
    <label>สถานที่ไป<input id="e-dest" value="${esc(b.destination)}"></label>
    <label>รายละเอียดเพิ่มเติม<textarea id="e-note">${esc(b.note)}</textarea></label>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm primary" data-act="edit-save" data-id="${b.id}">บันทึกการแก้ไข</button><button class="btn sm" data-act="edit-close" data-id="${b.id}">ยกเลิก</button></div>
  </div>`;
}
function renderMine(){
  const mine=S.bookings.filter(b=>S.user&&b.by===S.user.id).sort((a,b)=>a.start<b.start?1:-1);
  $('myCount').textContent = mine.length?`ทั้งหมด ${mine.length} รายการ`:'คำขอที่ส่งจากบัญชีนี้';
  $('myList').innerHTML = mine.length?mine.slice(0,60).map(b=>card(b,'mine')).join(''):`<div class="empty">ยังไม่มีการจอง กด "จองรถใหม่" เพื่อขอใช้รถคันแรก</div>`;
}
function renderCars(){
  const n=nowStr();
  $('carCards').innerHTML = S.vehicles.map(v=>{ const s=carStatus(v);
    const q=S.bookings.filter(b=>b.status==='approved'&&b.vehicle===v.id&&b.end>n).sort((a,b)=>a.start<b.start?-1:1).slice(0,4);
    const admin = S.isAdmin ? `<div style="border-top:1px dashed var(--line);padding-top:12px;display:grid;gap:10px">
      <div class="row"><label>ชื่อที่แสดง<input id="name-${v.id}" value="${esc(v.name)}"></label><label>ทะเบียนรถ<input id="plate-${v.id}" value="${esc(v.plate)}" placeholder="เช่น นข-1234"></label></div>
      <div class="row"><label>จำนวนที่นั่ง<input id="seats-${v.id}" type="number" min="1" max="60" value="${+v.seats}"></label>
      <label>สถานะ<select id="active-${v.id}"><option value="1" ${v.active?'selected':''}>พร้อมใช้งาน</option><option value="0" ${v.active?'':'selected'}>งดใช้ / ซ่อมบำรุง</option></select></label></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm primary" data-act="savecar" data-id="${v.id}">บันทึกข้อมูลรถ</button><button class="btn sm danger" data-act="delcar" data-id="${v.id}">${S.confirmDel===v.id?'ยืนยันลบ':'ลบรถ'}</button></div></div>` : '';
    return `<div class="panel carcard v-${v.kind}" id="car-${v.id}"><div class="pic">${art(v.kind)}</div>
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><h2 style="font-size:1.25rem">${esc(v.name)}</h2><span class="dotst" style="color:${s.col}">${s.txt}</span></div>
      <dl class="kv"><dt>ประเภท</dt><dd>${KIND[v.kind]}</dd><dt>ทะเบียน</dt><dd>${esc(v.plate)||'<span class="muted">ยังไม่ระบุ</span>'}</dd><dt>ที่นั่ง</dt><dd>${+v.seats} ที่นั่ง</dd></dl>
      <div><div class="small muted" style="margin-bottom:6px">คิวงานที่อนุมัติแล้ว</div><div class="queue">${q.length?q.map(b=>`<div><b>${thDate(b.start,{day:'numeric',month:'short'})} ${tm(b.start)}</b><span>${esc(b.destination)}</span></div>`).join(''):'<div class="muted">ยังไม่มีคิว</div>'}</div></div>
      ${admin}</div>`; }).join('') || '<div class="empty">ยังไม่มีข้อมูลรถ</div>';
}
$('carForm').addEventListener('submit',async e=>{ e.preventDefault();
  const kind=$('c-kind').value, name=$('c-name').value.trim()||KIND[kind];
  const { error } = await sb.from('vehicles').insert({kind,name,plate:$('c-plate').value.trim(),seats:Math.max(1,+$('c-seats').value||4),sort:S.vehicles.length+1});
  if(error){ toast(errText(error)); return; }
  $('c-name').value=''; $('c-plate').value=''; toast('เพิ่มรถแล้ว'); reload('vehicles');
});

/* =====================================================================
   REPORT
   ===================================================================== */
function renderReport(){
  const m=S.rMonth, ms=ymd(m)+'T00:00', me=ymd(new Date(m.getFullYear(),m.getMonth()+1,1))+'T00:00';
  $('rTitle').textContent=m.toLocaleDateString('th-TH',{month:'long',year:'numeric'});
  const toMs=s=>new Date(s).getTime();
  const appr=S.bookings.filter(b=>b.status==='approved'&&b.start<me&&b.end>ms);
  const hrs=b=>Math.max(0,(toMs(b.end<me?b.end:me)-toMs(b.start>ms?b.start:ms))/3600000);
  const byV=S.vehicles.map(v=>{ const l=appr.filter(b=>b.vehicle===v.id); return {v,n:l.length,h:l.reduce((a,b)=>a+hrs(b),0)}; });
  const total=byV.reduce((a,x)=>a+x.h,0), top=byV.slice().sort((a,b)=>b.h-a.h)[0];
  const all=S.bookings.filter(b=>b.start>=ms&&b.start<me);
  $('rKpis').innerHTML=[[appr.length,'ครั้งที่ใช้รถ'],[total.toFixed(1),'ชั่วโมงใช้งานรวม'],[top&&top.h?esc(top.v.plate||top.v.name):'—','ใช้บ่อยที่สุด'],[all.filter(b=>b.status==='rejected'||b.status==='cancelled').length,'ไม่อนุมัติ / ยกเลิก']]
    .map(([v,l])=>`<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('');
  const max=Math.max(1,...byV.map(x=>x.h));
  $('rBars').innerHTML=byV.map(x=>`<div class="bar v-${x.v.kind}"><span>${esc(x.v.plate||x.v.name)}</span><div class="track2"><div class="fill" style="width:${x.h/max*100}%"></div></div><span class="val">${x.h.toFixed(1)} ชม. · ${x.n}</span></div>`).join('')
    + (appr.length?'':'<div class="empty">ยังไม่มีการใช้รถที่อนุมัติในเดือนนี้</div>');
  const dep={}; appr.forEach(b=>{ const k=b.dept||'ไม่ระบุ'; dep[k]=dep[k]||{n:0,h:0}; dep[k].n++; dep[k].h+=hrs(b); });
  const rows=Object.entries(dep).sort((a,b)=>b[1].h-a[1].h);
  $('rDept').innerHTML=rows.length?rows.map(([k,v])=>`<tr><td>${esc(k)}</td><td class="n">${v.n}</td><td class="n">${v.h.toFixed(1)}</td></tr>`).join(''):`<tr><td colspan="3" class="muted">ยังไม่มีข้อมูล</td></tr>`;
}
$('rPrev').onclick=()=>{ S.rMonth=new Date(S.rMonth.getFullYear(),S.rMonth.getMonth()-1,1); renderReport(); };
$('rNext').onclick=()=>{ S.rMonth=new Date(S.rMonth.getFullYear(),S.rMonth.getMonth()+1,1); renderReport(); };

/* ---------- prefs ---------- */
$('pwForm').addEventListener('submit',async e=>{ e.preventDefault();
  const a=$('p-pass').value, c=$('p-pass2').value;
  if(a.length<6) return toast('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
  if(a!==c) return toast('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
  const { error } = await sb.auth.updateUser({ password:a });
  if(error) return toast('เปลี่ยนรหัสผ่านไม่สำเร็จ: '+error.message);
  $('p-pass').value=''; $('p-pass2').value=''; toast('เปลี่ยนรหัสผ่านแล้ว');
});
$('prefForm').addEventListener('submit',async e=>{ e.preventDefault();
  const p={full_name:$('p-name').value.trim(),dept:$('p-dept').value.trim(),phone:$('p-phone').value.trim()};
  const { error } = await sb.from('profiles').update(p).eq('id',S.user.id);
  if(error){ toast(errText(error)); return; }
  Object.assign(S.profile,p); $('f-name').value=p.full_name; $('f-dept').value=p.dept; $('f-phone').value=p.phone;
  renderHi(); toast('บันทึกแล้ว');
});

/* =====================================================================
   ADMIN
   ===================================================================== */
function renderAdmin(){
  if(!S.isAdmin) return;
  const n=nowStr(), today=ymd(new Date());
  const pending=S.bookings.filter(b=>b.status==='pending');
  const noDrv=S.bookings.filter(b=>b.status==='approved'&&!b.driverId&&b.end>n);
  const upcoming=S.bookings.filter(b=>b.status==='approved'&&b.end>n);
  $('pendingBadge').hidden=!pending.length; $('pendingBadge').textContent=pending.length;
  $('aKpis').innerHTML=[[pending.length,'รออนุมัติ',pending.length>0],[noDrv.length,'ยังไม่มีคนขับ',noDrv.length>0],[onDay(today).filter(b=>b.status==='approved').length,'งานวันนี้',false],[upcoming.length,'งานที่จะถึง',false]]
    .map(([v,l,a])=>`<div class="kpi ${a?'attn':''}"><b>${v}</b><span>${l}</span></div>`).join('');
  const f=S.filter;
  let list=f==='pending'?pending:f==='nodriver'?noDrv:f==='upcoming'?upcoming:S.bookings.slice();
  list.sort((a,b)=>f==='all'?(a.start<b.start?1:-1):(a.start<b.start?-1:1));
  const em={pending:'ไม่มีคำขอที่รออนุมัติ',nodriver:'ทุกงานที่อนุมัติมีคนขับครบแล้ว',upcoming:'ยังไม่มีงานที่จะถึง',all:'ยังไม่มีการจองในระบบ'}[f];
  $('adminList').innerHTML=list.length?list.slice(0,80).map(b=>card(b,'admin')).join(''):`<div class="empty">${em}</div>`;
  $('driverRows').innerHTML=S.drivers.length?S.drivers.map(d=>`<tr><td>${esc(d.name)}</td><td>${esc(d.phone)||'—'}</td><td>${esc(d.line_id)||'—'}</td><td class="n">${upcoming.filter(b=>b.driverId===d.id).length}</td>
    <td><button class="btn sm danger" data-act="deldrv" data-id="${d.id}">${S.confirmDel===d.id?'ยืนยันลบ':'ลบ'}</button></td></tr>`).join('')
    :`<tr><td colspan="5"><div class="empty">ยังไม่มีรายชื่อ เพิ่มพนักงานขับรถคนแรกจากแบบฟอร์ม</div></td></tr>`;
  $('userRows').innerHTML=S.profiles.map(p=>{
    const me=p.id===S.user.id;
    const roleCell = S.isSuper && !me
      ? `<select data-act="setrole" data-id="${p.id}" aria-label="สิทธิ์" style="width:auto;padding:5px 8px">${Object.entries(ROLE).map(([k,l])=>`<option value="${k}" ${k===p.role?'selected':''}>${l}</option>`).join('')}</select>`
      : (p.role==='user' ? 'ผู้ใช้ทั่วไป' : `<span class="role-pill">${ROLE[p.role]||p.role}</span>`);
    const canPw = !me && (S.isSuper || p.role==='user');
    let pw = me ? '<span class="small muted">คุณ (เปลี่ยนรหัสที่เมนูตั้งค่า)</span>' : !canPw ? '<span class="small muted">เฉพาะ Super Admin</span>'
      : S.pwOpen===p.id
        ? `<div class="pw-box"><input id="pw-${p.id}" placeholder="รหัสผ่านใหม่ อย่างน้อย 6 ตัว" autocomplete="off"><button class="btn sm" data-act="pw-gen" data-id="${p.id}">สุ่ม</button><button class="btn sm primary" data-act="pw-save" data-id="${p.id}">บันทึก</button><button class="btn sm" data-act="pw-close" data-id="${p.id}">ยกเลิก</button></div>`
        : `<button class="btn sm" data-act="pw-open" data-id="${p.id}">ตั้งรหัสผ่านใหม่</button>`;
    if(S.pwShown[p.id]) pw += `<div class="pw-new">รหัสใหม่: <code>${esc(S.pwShown[p.id])}</code> <button class="btn sm" data-act="copytext" data-text="${esc(S.pwShown[p.id])}">คัดลอก</button><span class="small muted"> แจ้งผู้ใช้ แล้วให้เปลี่ยนเองภายหลัง</span></div>`;
    return `<tr><td>${esc(p.full_name)||'—'}</td><td>${esc(p.dept)||'—'}</td><td>${esc(p.email)}</td><td>${roleCell}</td><td>${pw}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="muted">ยังไม่มีผู้ใช้</td></tr>';
  renderLine(); renderNotifs(); renderLineAdmin(); renderDriverLink('drvLink', false);
}
function renderNotifs(){
  if(!S.isAdmin) return;
  const unread=S.notifs.filter(n=>!n.read_at).length;
  $('notifBadge').hidden=!unread; $('notifBadge').textContent=unread;
  $('readAll').disabled=!unread;
  $('notifList').innerHTML = S.notifs.length ? S.notifs.map(n=>{
    const bk=S.bookings.find(x=>x.id===n.booking_id);
    const when=new Date(n.created_at).toLocaleString('th-TH',{day:'numeric',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit'});
    return `<div class="notif ${n.read_at?'':'unread'} ${bk?'v-'+V(bk.vehicle).kind:''}">
      <div class="notif-top"><span class="pill st-cancelled">ยกเลิกการจอง</span><span class="small muted">${when} น.</span></div>
      <div>${esc(n.message)}</div>
      ${bk?`<div class="small muted">${esc(vName(bk.vehicle))} · ${whenText(bk)} · ไปที่ ${esc(bk.destination)}</div>`:''}
      ${n.read_at?'':`<div><button class="btn sm" data-act="readnotif" data-id="${n.id}">อ่านแล้ว</button></div>`}
    </div>`; }).join('') : '<div class="empty">ยังไม่มีการแจ้งเตือน เมื่อผู้จองยกเลิกการจองที่อนุมัติแล้ว จะแสดงที่นี่</div>';
}
const LST={sent:'ส่งแล้ว',pending:'รอส่ง',sending:'กำลังส่ง',failed:'ส่งไม่สำเร็จ',skipped:'ไม่ได้ส่ง'};
function renderLineAdmin(){
  if(!S.isSuper) return;
  const L=S.line, st=L.status||{}, cfg=L.settings;
  const note=$('lineNotice');
  const problems=[];
  if(L.missing) problems.push('ยังไม่ได้ติดตั้งส่วน LINE ในฐานข้อมูล: รันไฟล์ supabase/line.sql ใน SQL Editor ตามคู่มือ docs/LINE.md');
  else if(st.fnError) problems.push(st.fnError);
  else if(L.status && !st.tokenSet) problems.push('ยังไม่ได้ตั้ง Secret LINE_CHANNEL_ACCESS_TOKEN ใน Supabase Edge Functions');
  else if(L.status && !st.secretSet) problems.push('ยังไม่ได้ตั้ง Secret LINE_CHANNEL_SECRET ใน Supabase Edge Functions');
  else if(st.botError) problems.push('Channel access token ใช้ไม่ได้: '+st.botError);
  note.hidden=!problems.length; note.textContent=problems.join(' · ');

  const bot=st.bot;
  $('lineBot').textContent = bot ? `บอท: ${bot.displayName||''}${bot.basicId?' ('+bot.basicId+')':''}` : '';
  const row=(kind,label,target,name,how)=>`<div class="conn-row"><div style="min-width:0"><b>${label}</b>
      ${target?`<span class="small conn-ok">✅ เชื่อมแล้ว: ${esc(name||'')}</span>`:`<span class="small conn-no">ยังไม่เชื่อม · ${how}</span>`}</div>
      ${target?`<button class="btn sm danger" data-act="lineunlink" data-id="${kind}">${S.confirmDel==='line-'+kind?'ยืนยันยกเลิก':'ยกเลิกการเชื่อม'}</button>`:''}</div>`;
  $('lineConn').innerHTML = cfg ? row('drivers','กลุ่มพนักงานขับรถ',cfg.drivers_target,cfg.drivers_name,'เชิญบอทเข้ากลุ่ม แล้วพิมพ์คำสั่งพร้อมรหัส')
    + row('admins','แจ้งเตือนผู้ดูแล',cfg.admin_target,cfg.admin_name,'เพิ่มบอทเป็นเพื่อน แล้วพิมพ์คำสั่งพร้อมรหัส') : '';

  const pair=$('linePair');
  if(L.code && Date.now()<L.codeExp){
    const exp=new Date(L.codeExp).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
    const c1='/ตั้งกลุ่มคนขับ '+L.code, c2='/ตั้งผู้ดูแล '+L.code;
    pair.hidden=false;
    pair.innerHTML=`<div class="small muted">รหัสเชื่อมต่อ (ใช้ได้ถึง ${exp} น.)</div><div class="code">${L.code}</div>
      <div class="cmd"><span class="small">ในกลุ่มคนขับ พิมพ์</span><code>${c1}</code><button class="btn sm" data-act="copytext" data-text="${c1}">คัดลอก</button></div>
      <div class="cmd"><span class="small">ในแชทส่วนตัวกับบอท พิมพ์</span><code>${c2}</code><button class="btn sm" data-act="copytext" data-text="${c2}">คัดลอก</button></div>`;
  } else { pair.hidden=true; pair.innerHTML=''; }

  // ---- โควตาข้อความ ----
  const stats=L.stats||{}, members=st.driversMembers||0;
  const lim = st.quota ? (st.quota.type==='limited' ? st.quota.value : null) : 300;
  const fromLine = st.consumption && typeof st.consumption.totalUsage==='number';
  const used = fromLine ? st.consumption.totalUsage : (stats.drivers_sent||0)*(members||1)+(stats.admins_sent||0);
  const now=new Date(), dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate(), dom=now.getDate();
  const proj = Math.round(used/dom*dim);
  const pct = lim ? Math.min(100, used/lim*100) : 0;
  const lvl = lim && used>=lim ? 'bad' : lim && (used/lim>=.8 || proj>lim) ? 'warn' : '';
  $('lineKpis').innerHTML = [
    `<div class="kpi ${lvl==='bad'?'bad':lvl==='warn'?'attn':''}"><b>${used}${lim?`<span style="font-size:1rem;color:var(--muted)"> / ${lim}</span>`:''}</b><span>ข้อความที่ใช้ไปเดือนนี้</span>
      ${lim?`<div class="meter ${lvl}"><i style="width:${pct}%"></i></div>`:''}<small>${fromLine?'ตัวเลขจาก LINE (อาจช้าไม่กี่นาที)':'ประมาณจากประวัติการส่ง'}</small></div>`,
    `<div class="kpi ${lvl==='bad'?'bad':''}"><b>${lim?Math.max(0,lim-used):'∞'}</b><span>เหลือใช้ได้เดือนนี้</span><small>${lim?'โควตาฟรีรีเซ็ตวันที่ 1 ของเดือน':'แพ็กเกจไม่จำกัดจำนวน'}</small></div>`,
    `<div class="kpi ${lim&&proj>lim?'attn':''}"><b>~${proj}</b><span>คาดการณ์ถึงสิ้นเดือน</span><small>${lim&&proj>lim?'อาจเกินโควตา ลองปิดการแจ้งทันที':'จากอัตราการใช้ ${dom} วันที่ผ่านมา'.replace('${dom}',dom)}</small></div>`,
    `<div class="kpi"><b>${(stats.drivers_sent||0)+(stats.admins_sent||0)}</b><span>ครั้งที่ระบบส่งเดือนนี้</span><small>กลุ่มคนขับ ${stats.drivers_sent||0} ครั้ง${members?` × ${members} คน`:''} · ผู้ดูแล ${stats.admins_sent||0} ครั้ง</small></div>`
  ].join('');
  $('lineQuota').textContent = members ? `กลุ่มคนขับมี ${members} คน ส่งเข้ากลุ่ม 1 ครั้งนับเป็น ${members} ข้อความ · ข้อความที่บอทตอบคำสั่ง (/งานวันนี้ ฯลฯ) ไม่นับโควตา` : '';
  $('rmState').innerHTML = st.richMenuId ? '<span class="conn-ok">✅ ติดตั้งเมนูแล้ว</span> · กดติดตั้งซ้ำเพื่ออัปเดต' : 'เมนูปุ่มลัดในแชทส่วนตัวกับบอท: งานวันนี้ · พรุ่งนี้ · สัปดาห์นี้ · สัปดาห์หน้า · ปฏิทิน';
  renderDriverLink('lineDrvLink', true);

  if(cfg && !L.dirty){
    const hrs=Array.from({length:24},(_,h)=>`<option value="${h}">${pad(h)}:00</option>`).join('');
    if(!$('ls-hour').options.length) $('ls-hour').innerHTML=hrs;
    if(!$('ls-whour').options.length) $('ls-whour').innerHTML=hrs;
    $('ls-daily').checked=cfg.daily_enabled; $('ls-hour').value=String(cfg.daily_hour);
    $('ls-weekly').checked=cfg.weekly_enabled!==false; $('ls-whour').value=String(cfg.weekly_hour??16);
    $('ls-changes').checked=cfg.notify_changes; $('ls-cancel').checked=cfg.notify_cancel_admin; $('ls-new').checked=cfg.notify_new_request_admin;
  }
  const dis = L.missing || !cfg;
  ['lineCode','sendNow','sendTest','rmSetup'].forEach(id=>$(id).disabled=dis);

  $('lineLog').innerHTML = L.outbox.length ? L.outbox.map(o=>{
    const t=new Date(o.created_at).toLocaleString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
    return `<div class="logrow"><div class="meta"><span class="pill st-${o.status}">${LST[o.status]||o.status}</span><span>${o.audience==='drivers'?'กลุ่มคนขับ':'ผู้ดูแล'}</span><span>${t} น.</span></div>
      <div class="txt">${esc(o.body.split('\n').slice(0,2).join(' · '))}</div>${o.error?`<div class="err">${esc(o.error)}</div>`:''}</div>`;
  }).join('') : '<div class="empty">ยังไม่มีการส่งข้อความ</div>';
}
function jobText(b,i){
  return `${i!=null?(i+1)+'. ':''}${vName(b.vehicle)}
   เวลา: ${whenText(b)}
   คนขับ: ${driverName(b.driverId)||'ยังไม่จัด'}
   ผู้ขอใช้: ${b.requester} (${b.dept}) โทร ${b.phone}
   ไปที่: ${b.destination}
   ภารกิจ: ${b.purpose}${b.note?' – '+b.note:''} · ${b.passengers} คน`;
}
function renderLine(){ if(S.view==='line') loadPreview(); }
function renderDriverLink(id, canReset){
  const el=$(id); if(!el) return;
  if(!S.driverLink){ el.innerHTML='<div class="small muted">ยังใช้ไม่ได้ ต้องรันไฟล์ supabase/line.sql เวอร์ชันล่าสุดก่อน</div>'; return; }
  el.innerHTML=`<p class="small muted" style="margin:0 0 8px">ลิงก์เปิดดูตารางงานในมือถือ ไม่ต้องล็อกอิน ส่งให้เฉพาะพนักงานขับรถ (หรือให้กด "ปฏิทินงาน" ในเมนู LINE)</p>
    <div class="linkbox"><code>${esc(S.driverLink)}</code><button class="btn sm" data-act="copytext" data-text="${esc(S.driverLink)}">คัดลอก</button>
    <a class="btn sm" href="${esc(S.driverLink)}" target="_blank" rel="noopener">เปิดดู</a>
    ${canReset&&S.isSuper?`<button class="btn sm danger" data-act="drvlinkreset">${S.confirmDel==='drvlink'?'ยืนยัน (ลิงก์เก่าจะใช้ไม่ได้)':'สร้างลิงก์ใหม่'}</button>`:''}</div>`;
}
$('lineDay').onchange=()=>loadPreview();
$('rmSetup').onclick=async()=>{
  $('rmSetup').disabled=true; toast('กำลังติดตั้งเมนู…');
  try{
    const { data:{ session } } = await sb.auth.getSession();
    const r = await fetch(CFG.SUPABASE_URL+'/functions/v1/line-bot', { method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey':CFG.SUPABASE_KEY, 'Authorization':'Bearer '+(session?session.access_token:'') },
      body: JSON.stringify({action:'richmenu'}) });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || d.error) toast('ติดตั้งไม่สำเร็จ: '+(d.error||r.status)); else { toast('ติดตั้งเมนูแล้ว เปิดแชทกับบอทเพื่อดู'); lineStatus(); }
  }catch(e){ toast('เรียกฟังก์ชัน line-bot ไม่ได้'); }
  $('rmSetup').disabled=false;
};
$('lineForm').addEventListener('input',()=>{ S.line.dirty=true; });
$('lineForm').addEventListener('submit',async e=>{ e.preventDefault();
  const { error } = await sb.rpc('line_save_settings',{ p_daily_enabled:$('ls-daily').checked, p_daily_hour:+$('ls-hour').value,
    p_weekly_enabled:$('ls-weekly').checked, p_weekly_hour:+$('ls-whour').value,
    p_notify_changes:$('ls-changes').checked, p_notify_cancel_admin:$('ls-cancel').checked, p_notify_new_request_admin:$('ls-new').checked });
  if(error) return toast(errText(error));
  S.line.dirty=false; toast('บันทึกการตั้งค่า LINE แล้ว'); reload('line');
});
$('lineCode').onclick=async()=>{
  const { data, error } = await sb.rpc('line_new_pair_code');
  if(error) return toast(errText(error));
  S.line.code=data; S.line.codeExp=Date.now()+30*60000; renderLineAdmin();
};
$('sendNow').onclick=async()=>{
  const what=$('lineDay').value;
  const { error } = await sb.rpc('line_send_now',{p_what:what});
  if(error) return toast(errText(error)); toast('ส่งเข้าคิวแล้ว ข้อความจะถึงกลุ่มภายในไม่กี่วินาที'); reload('line');
};
$('sendTest').onclick=async()=>{
  const { error } = await sb.rpc('line_send_now',{p_what:'test'});
  if(error) return toast(errText(error)); toast('ส่งข้อความทดสอบแล้ว'); reload('line');
};
$('copyLine').onclick=()=>copy($('lineMsg').textContent);
$('jobFilter').onclick=e=>{ const b=e.target.closest('button'); if(!b) return; S.filter=b.dataset.f;
  $('jobFilter').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b)); renderAdmin(); };
$('driverForm').addEventListener('submit',async e=>{ e.preventDefault(); const name=$('d-name').value.trim(); if(!name) return;
  const { error } = await sb.from('drivers').insert({name,phone:$('d-phone').value.trim(),line_id:$('d-line').value.trim()});
  if(error){ toast(errText(error)); return; }
  $('d-name').value=$('d-phone').value=$('d-line').value=''; toast('เพิ่มพนักงานขับรถแล้ว'); reload('drivers'); });

function armConfirm(id){ S.confirmDel=id; renderAll(); setTimeout(()=>{ if(S.confirmDel===id){ S.confirmDel=null; renderAll(); } },4000); }
document.addEventListener('click',async e=>{
  const b=e.target.closest('button[data-act]'); if(!b) return;
  const id=b.dataset.id, act=b.dataset.act, bk=S.bookings.find(x=>x.id===id);
  const upd=async (patch,ok)=>{ const { error }=await sb.from('bookings').update(patch).eq('id',id); if(error){ toast(errText(error)); return false; } toast(ok); reload('bookings'); return true; };
  if(act==='cancel-open'){ S.cancelOpen=id; renderMine(); const i=$('cr-'+id); if(i) i.focus(); return; }
  if(act==='cancel-close'){ S.cancelOpen=null; renderMine(); return; }
  if(act==='cancel'){
    const reason=($('cr-'+id)||{}).value||''; const wasApproved=bk&&bk.status==='approved';
    b.disabled=true;
    const ok=await upd({status:'cancelled',cancel_reason:reason.trim()}, wasApproved?'ยกเลิกการจองแล้ว ระบบแจ้งผู้ดูแลระบบให้แล้ว':'ยกเลิกคำขอแล้ว');
    if(ok) S.cancelOpen=null; else b.disabled=false;
    return;
  }
  if(act==='copytext') return copy(b.dataset.text);
  if(act==='drvlinkreset'){
    if(S.confirmDel!=='drvlink'){ S.confirmDel='drvlink'; renderDriverLink('lineDrvLink',true); setTimeout(()=>{ if(S.confirmDel==='drvlink'){ S.confirmDel=null; renderDriverLink('lineDrvLink',true); } },4000); return; }
    S.confirmDel=null; const { data, error }=await sb.rpc('driver_link_reset');
    if(error) return toast(errText(error)); S.driverLink=data; toast('สร้างลิงก์ใหม่แล้ว ลิงก์เก่าใช้ไม่ได้อีก'); renderAdmin(); return;
  }
  if(act==='lineunlink'){
    if(S.confirmDel!=='line-'+id){ S.confirmDel='line-'+id; renderLineAdmin(); setTimeout(()=>{ if(S.confirmDel==='line-'+id){ S.confirmDel=null; renderLineAdmin(); } },4000); return; }
    S.confirmDel=null; const { error }=await sb.rpc('line_unlink',{p_kind:id});
    if(error) return toast(errText(error)); toast('ยกเลิกการเชื่อมแล้ว'); reload('line'); return;
  }
  if(act==='readnotif'||act==='readall'){
    const qb=sb.from('notifications').update({read_at:new Date().toISOString()});
    const { error } = act==='readall' ? await qb.is('read_at',null) : await qb.eq('id',id);
    if(error) return toast(errText(error)); reload('notifications'); return;
  }
  if(act==='approve') return upd({status:'approved'}, bk&&bk.driverId?'อนุมัติแล้ว':'อนุมัติแล้ว อย่าลืมจัดคนขับ');
  if(act==='reject') return upd({status:'rejected'},'บันทึกว่าไม่อนุมัติแล้ว');
  if(act==='revoke') return upd({status:'cancelled'},'ยกเลิกงานแล้ว');
  if(act==='reopen') return upd({status:'pending'},'ย้ายกลับไปรออนุมัติแล้ว');
  if(act==='copy') return copy('🚗 แจ้งงานขับรถ\n'+jobText(bk));
  if(act==='deldrv'){
    if(S.confirmDel!==id) return armConfirm(id);
    S.confirmDel=null; const { error }=await sb.from('drivers').delete().eq('id',id);
    if(error) return toast(errText(error)); toast('ลบรายชื่อแล้ว'); reload('drivers'); reload('bookings'); return;
  }
  if(act==='savecar'){
    const { error }=await sb.from('vehicles').update({name:$('name-'+id).value.trim()||V(id).name,plate:$('plate-'+id).value.trim(),seats:Math.max(1,+$('seats-'+id).value||1),active:$('active-'+id).value==='1'}).eq('id',id);
    if(error) return toast(errText(error)); toast('บันทึกข้อมูลรถแล้ว'); reload('vehicles'); return;
  }
  if(act==='delcar'){
    if(S.confirmDel!==id) return armConfirm(id);
    S.confirmDel=null; const { error }=await sb.from('vehicles').delete().eq('id',id);
    if(error) return toast(errText(error)); toast('ลบรถแล้ว'); reload('vehicles'); return;
  }
  if(act==='edit-open'){ S.editId=id; renderAdmin(); return; }
  if(act==='edit-close'){ S.editId=null; renderAdmin(); return; }
  if(act==='edit-save'){
    const sd=$('e-sd').value, st=$('e-st').value, ed=$('e-ed').value, et=$('e-et').value;
    if(!sd||!st||!ed||!et) return toast('กรุณากรอกวันและเวลาให้ครบ');
    if(ed+'T'+et<=sd+'T'+st) return toast('เวลากลับต้องอยู่หลังเวลาออกเดินทาง');
    if(!$('e-req').value.trim()||!$('e-dest').value.trim()) return toast('กรุณากรอกผู้ขอและสถานที่ไป');
    b.disabled=true;
    const ok=await upd({ vehicle_id:$('e-veh').value, start_at:toISO(sd+'T'+st), end_at:toISO(ed+'T'+et),
      requester:$('e-req').value.trim(), dept:$('e-dept').value.trim(), phone:$('e-phone').value.trim(),
      passengers:Math.max(1,+$('e-pax').value||1), purpose:$('e-purpose').value, destination:$('e-dest').value.trim(), note:$('e-note').value.trim() }, 'บันทึกการแก้ไขแล้ว');
    if(ok) S.editId=null; else b.disabled=false;
    return;
  }
  if(act==='delbk'){
    if(S.confirmDel!=='del-'+id) return armConfirm('del-'+id);
    S.confirmDel=null; const { error }=await sb.from('bookings').delete().eq('id',id);
    if(error) return toast(errText(error)); toast('ลบการจองแล้ว'); reload('bookings'); return;
  }
  if(act==='pw-open'){ S.pwOpen=id; renderAdmin(); const i=$('pw-'+id); if(i) i.focus(); return; }
  if(act==='pw-close'){ S.pwOpen=null; renderAdmin(); return; }
  if(act==='pw-gen'){
    const cs='abcdefghjkmnpqrstuvwxyz23456789'; const a=new Uint32Array(8); crypto.getRandomValues(a);
    $('pw-'+id).value=Array.from(a,x=>cs[x%cs.length]).join(''); return;
  }
  if(act==='pw-save'){
    const pw=$('pw-'+id).value.trim();
    if(pw.length<6) return toast('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
    const { error }=await sb.rpc('admin_set_password',{p_user:id,p_password:pw});
    if(error) return toast(errText(error));
    S.pwOpen=null; S.pwShown[id]=pw; toast('ตั้งรหัสผ่านใหม่แล้ว'); renderAdmin(); return;
  }
});
document.addEventListener('change',async e=>{
  const r=e.target.closest('select[data-act="setrole"]');
  if(r){
    const { error }=await sb.from('profiles').update({role:r.value}).eq('id',r.dataset.id);
    if(error){ toast(errText(error)); reload('profiles'); return; }
    toast('เปลี่ยนสิทธิ์เป็น '+ROLE[r.value]+' แล้ว'); reload('profiles'); return;
  }
  const s=e.target.closest('select[data-act="driver"]'); if(!s) return;
  const { error }=await sb.from('bookings').update({driver_id:s.value||null}).eq('id',s.dataset.id);
  if(error){ toast(errText(error)); reload('bookings'); return; }
  toast(s.value?'จัด '+driverName(s.value)+' ลงงานแล้ว':'นำคนขับออกจากงานแล้ว'); reload('bookings');
});

/* ---------- render ---------- */
function renderAll(){ if(!S.user) return; renderCal(); renderFleet(); renderVPick(); renderMine(); renderCars(); renderReport(); renderAdmin(); }
S.rMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
setInterval(()=>{ if(S.user) renderFleet(); },60000);
})();

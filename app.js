(function(){
'use strict';
const CFG = window.APP_CONFIG || {};
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);

const KIND = { van:'รถตู้', pickup:'รถกระบะ', sedan:'รถเก๋ง' };
const ST = { pending:'รออนุมัติ', approved:'อนุมัติแล้ว', rejected:'ไม่อนุมัติ', cancelled:'ยกเลิก' };
const PURPOSES = ['ประชุม / สัมมนา','ติดต่อราชการ','ลงพื้นที่ / ตรวจงาน','อบรม / ศึกษาดูงาน','รับ-ส่งเอกสาร / พัสดุ','รับ-ส่งบุคคล','อื่น ๆ'];
const S = { user:null, profile:null, isAdmin:false, vehicles:[], bookings:[], drivers:[], profiles:[], notifs:[], cancelOpen:null,
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
$('authMode').onclick=e=>{ const b=e.target.closest('button'); if(!b) return; authMode=b.dataset.m;
  $('authMode').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));
  $('upFields').hidden = authMode!=='up';
  $('authBtn').textContent = authMode==='up' ? 'สมัครใช้งาน' : 'เข้าสู่ระบบ';
  $('a-pass').autocomplete = authMode==='up' ? 'new-password' : 'current-password';
  $('authMsg').textContent=''; };
$('authForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const msg=$('authMsg'), email=$('a-email').value.trim(), password=$('a-pass').value;
  msg.className='auth-msg';
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

sb.auth.onAuthStateChange((event, session)=>{
  setTimeout(()=>onSession(session), 0);   // หลีกเลี่ยงการเรียก Supabase ภายใน callback โดยตรง
});

let bootedFor=null;
async function onSession(session){
  $('boot').hidden=true;
  if(!session){
    bootedFor=null; S.user=null; S.profile=null; S.isAdmin=false;
    if(S.channel){ sb.removeChannel(S.channel); S.channel=null; }
    $('app').hidden=true; $('userchip').hidden=true; $('auth').hidden=false;
    return;
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
  S.isAdmin = S.profile.role==='admin';
  document.querySelectorAll('.admin-only').forEach(el=>el.hidden=!S.isAdmin);
  const p=S.profile;
  $('p-email').value=p.email||S.user.email||''; $('p-name').value=p.full_name||''; $('p-dept').value=p.dept||''; $('p-phone').value=p.phone||'';
  if(!$('f-name').value) $('f-name').value=p.full_name||'';
  if(!$('f-dept').value) $('f-dept').value=p.dept||'';
  if(!$('f-phone').value) $('f-phone').value=p.phone||'';
  renderHi();
}
function renderHi(){
  const p=S.profile||{};
  $('hi').innerHTML = `สวัสดี, <b>${p.full_name?'คุณ'+esc(p.full_name):'ผู้ใช้งาน'}</b><span>${esc(p.dept || (S.isAdmin?'ผู้ดูแลระบบ':S.user?.email||''))}</span>`;
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
async function loadProfiles(){
  if(!S.isAdmin) return;
  const { data } = await sb.from('profiles').select('*').order('full_name');
  S.profiles=data||[];
}
async function loadAll(){
  const errs=(await Promise.all([loadVehicles(),loadDrivers(),loadBookings(),loadProfiles(),loadNotifs()])).filter(Boolean);
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
    renderAll();
  },250);
}
function subscribe(){
  if(S.channel) sb.removeChannel(S.channel);
  S.channel = sb.channel('car-reservation')
    .on('postgres_changes',{event:'*',schema:'public',table:'bookings'},()=>reload('bookings'))
    .on('postgres_changes',{event:'*',schema:'public',table:'drivers'},()=>reload('drivers'))
    .on('postgres_changes',{event:'*',schema:'public',table:'vehicles'},()=>reload('vehicles'))
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
const ADMIN_VIEWS=['admin','notifs','drivers','users','line'];
function go(v){
  if(ADMIN_VIEWS.includes(v) && !S.isAdmin) v='home';
  if(!VIEWS.includes(v)) v='home';
  S.view=v;
  document.querySelectorAll('.navbtn').forEach(b=>{ if(b.dataset.v===v) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  VIEWS.forEach(k=>$('v-'+k).hidden = k!==v);
  try{ history.replaceState(null,'','#'+v); }catch(e){}
  const nb=document.querySelector(`.navbtn[data-v="${v}"]`); if(nb && innerWidth<900) nb.scrollIntoView({block:'nearest',inline:'center'});
  window.scrollTo({top:0});
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
    </div>`;
  }
  return `<div class="bk v-${kind}">
    <div class="bk-top"><div class="bk-title"><span class="vtag">${esc(vShort(b.vehicle))}</span>${esc(b.destination)}</div><span class="pill st-${b.status}">${ST[b.status]||esc(b.status)}</span></div>
    <div class="when">${whenText(b)}</div>
    <dl><dt>ผู้ขอ</dt><dd>${esc(b.requester)} · ${esc(b.dept)}${mode==='admin'?` · ${esc(b.phone)}`:''}</dd>
      <dt>ภารกิจ</dt><dd>${esc(b.purpose)}${b.note?' – '+esc(b.note):''} (${+b.passengers||1} คน)</dd>
      <dt>คนขับ</dt><dd>${drv?esc(drv):'<span class="muted">ยังไม่จัด</span>'}</dd>
      ${b.status==='cancelled'&&b.cancelReason?`<dt>เหตุผลยกเลิก</dt><dd>${esc(b.cancelReason)}</dd>`:''}</dl>${actions}</div>`;
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
  $('userRows').innerHTML=S.profiles.map(p=>`<tr><td>${esc(p.full_name)||'—'}</td><td>${esc(p.dept)||'—'}</td><td>${esc(p.email)}</td>
    <td>${p.role==='admin'?'<span class="role-pill">ผู้ดูแลระบบ</span>':'ผู้ใช้ทั่วไป'}</td>
    <td>${p.id===S.user.id?'<span class="small muted">คุณ</span>':`<button class="btn sm" data-act="role" data-id="${p.id}" data-role="${p.role==='admin'?'user':'admin'}">${p.role==='admin'?'ถอนสิทธิ์ผู้ดูแล':'ตั้งเป็นผู้ดูแล'}</button>`}</td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">ยังไม่มีผู้ใช้</td></tr>';
  renderLine(); renderNotifs();
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
function jobText(b,i){
  return `${i!=null?(i+1)+'. ':''}${vName(b.vehicle)}
   เวลา: ${whenText(b)}
   คนขับ: ${driverName(b.driverId)||'ยังไม่จัด'}
   ผู้ขอใช้: ${b.requester} (${b.dept}) โทร ${b.phone}
   ไปที่: ${b.destination}
   ภารกิจ: ${b.purpose}${b.note?' – '+b.note:''} · ${b.passengers} คน`;
}
function renderLine(){
  const days=+$('lineDay').value, base=addDays(new Date(),days===1?1:0);
  const from=ymd(base), to=ymd(addDays(base,days===7?7:0));
  const jobs=S.bookings.filter(b=>b.status==='approved'&&b.start.slice(0,10)<=to&&b.end.slice(0,10)>=from).sort((a,b)=>a.start<b.start?-1:1);
  const head=days===7?`📋 งานขับรถ ${thDate(from,{day:'numeric',month:'short'})} – ${thDate(to,{day:'numeric',month:'short',year:'2-digit'})}`
    :`📋 งานขับรถ${days===1?'พรุ่งนี้':'วันนี้'} ${thDate(from,{weekday:'long',day:'numeric',month:'long',year:'numeric'})}`;
  $('lineMsg').textContent=head+'\n\n'+(jobs.length?jobs.map(jobText).join('\n\n'):'ไม่มีงาน')+'\n\nหากติดขัดแจ้งผู้ดูแลระบบได้ทันที';
}
$('lineDay').onchange=renderLine;
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
  if(act==='role'){
    const { error }=await sb.from('profiles').update({role:b.dataset.role}).eq('id',id);
    if(error) return toast(errText(error)); toast('เปลี่ยนสิทธิ์แล้ว'); reload('profiles'); return;
  }
});
document.addEventListener('change',async e=>{
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

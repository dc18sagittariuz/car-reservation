(function(){
'use strict';
const CFG = window.APP_CONFIG || {};
const TOKEN = new URLSearchParams(location.search).get('k') || '';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2,'0');
const ymd = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const monday = d => { const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); return addDays(x, -((x.getDay()+6)%7)); };
const hm = d => pad(d.getHours())+':'+pad(d.getMinutes());
const KIND = { van:'รถตู้', pickup:'รถกระบะ', sedan:'รถเก๋ง' };

let week = monday(new Date());
let data = { drivers:[], jobs:[] };
let who = '';
try{ who = localStorage.getItem('drv-who') || ''; }catch(e){}

async function load(){
  if(!TOKEN){ $('list').innerHTML='<div class="msgbox">ลิงก์ไม่ครบ กรุณาเปิดจากเมนู "ปฏิทินงาน" ในไลน์ หรือขอลิงก์จากผู้ดูแลระบบ</div>'; $('wkTitle').textContent=''; return; }
  try{
    const r = await fetch(CFG.SUPABASE_URL+'/rest/v1/rpc/driver_view', { method:'POST',
      headers:{ 'Content-Type':'application/json', apikey:CFG.SUPABASE_KEY },
      body: JSON.stringify({ p_token:TOKEN, p_from:ymd(week), p_to:ymd(addDays(week,6)) }) });
    const body = await r.json();
    if(!r.ok){
      $('list').innerHTML = /invalid_token/.test(body.message||'')
        ? '<div class="msgbox">ลิงก์นี้ใช้ไม่ได้แล้ว อาจมีการเปลี่ยนลิงก์ใหม่<br>กด "ปฏิทินงาน" ในไลน์อีกครั้ง หรือขอลิงก์ใหม่จากผู้ดูแลระบบ</div>'
        : '<div class="msgbox">โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง</div>';
      return;
    }
    data = body; render();
  }catch(e){ $('list').innerHTML='<div class="msgbox">เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่</div>'; }
}

function render(){
  // driver filter
  const sel=$('who');
  sel.innerHTML='<option value="">ทุกคน</option>'+data.drivers.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('')+'<option value="none">ยังไม่จัดคนขับ</option>';
  if(who && !data.drivers.some(d=>d.id===who) && who!=='none') who='';
  sel.value=who;

  const end=addDays(week,6), todayK=ymd(new Date());
  $('wkTitle').textContent = `${week.toLocaleDateString('th-TH',{day:'numeric',month:'short'})} – ${end.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'})}`;
  const jobs = data.jobs.map(j=>({...j, s:new Date(j.start_at), e:new Date(j.end_at)}));
  const match = j => !who || (who==='none' ? !j.driver_id : j.driver_id===who);

  let strip='', list='';
  for(let i=0;i<7;i++){
    const d=addDays(week,i), k=ymd(d), dEnd=addDays(d,1);
    const dayJobs = jobs.filter(j=>j.s<dEnd && j.e>d);
    const shown = dayJobs.filter(match);
    const cls = shown.length ? (who && who!=='none' ? 'mine' : 'has') : '';
    strip += `<button class="sd ${k===todayK?'today':''}" data-k="${k}"><small>${d.toLocaleDateString('th-TH',{weekday:'short'})}</small><b>${d.getDate()}</b><span class="cnt ${cls}">${shown.length}</span></button>`;
    list += `<section class="dday" id="d-${k}"><h3>${d.toLocaleDateString('th-TH',{weekday:'long',day:'numeric',month:'long'})}
      ${k===todayK?'<span class="tag">วันนี้</span>':''}<span class="n">${shown.length?shown.length+' งาน':''}</span></h3>
      <div class="jobs">${shown.length ? shown.map(j=>card(j,d,dEnd)).join('') : '<div class="dempty">ไม่มีงาน</div>'}</div></section>`;
  }
  $('strip').innerHTML=strip;
  $('list').innerHTML=list+`<div class="upd">อัปเดตล่าสุด ${hm(new Date())} น. · ข้อมูลรีเฟรชเองทุก 5 นาที</div>`;
  $('strip').querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{ const el=$('d-'+b.dataset.k); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); });
}

function card(j,d,dEnd){
  const sameStart = j.s>=d, sameEnd = j.e<=dEnd;
  const mine = who && who!=='none' && j.driver_id===who;
  const tel = j.phone ? `<a href="tel:${esc(j.phone.replace(/[^0-9+]/g,''))}">${esc(j.phone)}</a>` : '';
  return `<article class="job v-${esc(j.kind||'van')} ${mine?'mine':''}">
    <div class="tcol"><b>${sameStart?hm(j.s):'ต่อ'}</b><span>${sameEnd?hm(j.e):j.e.toLocaleDateString('th-TH',{day:'numeric',month:'short'})+' '+hm(j.e)}</span></div>
    <div class="jinfo">
      <div class="jtop"><span class="vtag">${esc(j.plate||j.vehicle||KIND[j.kind]||'รถ')}</span>${j.plate?`<span class="small muted">${esc(j.vehicle||'')}</span>`:''}${mine?'<span class="minepill">งานของคุณ</span>':''}</div>
      <div class="jdest">📍 ${esc(j.destination)}</div>
      <div class="jdrv ${j.driver?'':'none'}">👤 ${j.driver?esc(j.driver):'ยังไม่จัดคนขับ'}</div>
      <div class="jsub">🙋 ${esc(j.requester)}${j.dept?' · '+esc(j.dept):''}${tel?' · '+tel:''}</div>
      <div class="jsub">📝 ${esc(j.purpose)}${j.note?' – '+esc(j.note):''} · ${+j.passengers||1} คน</div>
    </div></article>`;
}

$('who').onchange=e=>{ who=e.target.value; try{ localStorage.setItem('drv-who',who); }catch(x){} render(); };
$('prev').onclick=()=>{ week=addDays(week,-7); load(); };
$('next').onclick=()=>{ week=addDays(week,7); load(); };
$('today').onclick=()=>{ week=monday(new Date()); load().then(()=>{ const el=$('d-'+ymd(new Date())); if(el) el.scrollIntoView({block:'start'}); }); };
setInterval(load, 5*60000);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) load(); });
load();
})();

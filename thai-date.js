/* ปฏิทินเลือกวันที่แบบไทย: แสดง วว/ดด/ปปปป (พ.ศ.) ชื่อเดือนและวันภาษาไทย
   ทุก <input type="date"> ในหน้าจะถูกแปลงอัตโนมัติ (รวมช่องที่สร้างทีหลัง)
   ค่า .value ยังเป็น YYYY-MM-DD (ค.ศ.) เหมือนเดิม และยิง event 'change' เมื่อเลือกวัน */
(function(){
'use strict';
const BE = 543;
const MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const DOW = ['อา','จ','อ','พ','พฤ','ศ','ส'];
const pad = n => String(n).padStart(2,'0');
const ymd = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parse = s => { const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m ? new Date(+m[1],+m[2]-1,+m[3]) : null; };
const show = s => { const d=parse(s); return d ? `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()+BE}` : ''; };
const NATIVE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');

const css = document.createElement('style');
css.textContent = `
.tdate{cursor:pointer;padding-right:40px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23677a9b' stroke-width='1.8' stroke-linecap='round'%3E%3Crect x='3.5' y='5' width='17' height='15' rx='2.5'/%3E%3Cpath d='M3.5 10h17M8 3v4M16 3v4'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:20px}
.tdp{position:absolute;z-index:60;width:296px;max-width:calc(100vw - 32px);background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 32px rgba(20,40,80,.18);padding:12px}
.tdp-head{display:flex;align-items:center;gap:6px;margin-bottom:8px}
.tdp-head b{flex:1;text-align:center;font-family:var(--display);font-weight:500;font-size:1rem}
.tdp-nav{width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:var(--sunk);color:var(--ink);cursor:pointer;display:grid;place-items:center;font-size:1.1rem;line-height:1}
.tdp-nav:hover{border-color:var(--muted)}
.tdp-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center}
.tdp-dow{font-size:.8rem;color:var(--muted);padding:4px 0;font-weight:500}
.tdp-day{border:0;background:none;color:var(--ink);height:36px;border-radius:9px;cursor:pointer;font:inherit;font-size:.92rem}
.tdp-day:hover{background:var(--primary-soft)}
.tdp-day.out{color:var(--muted);opacity:.55}
.tdp-day.today{box-shadow:inset 0 0 0 1.5px var(--primary);font-weight:600}
.tdp-day.sel{background:var(--primary);color:var(--primary-ink);font-weight:600}
.tdp-foot{display:flex;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid var(--line)}
.tdp-foot button{border:0;background:none;color:var(--primary);cursor:pointer;font:inherit;font-size:.9rem;padding:4px 6px;border-radius:6px}
.tdp-foot button:hover{background:var(--primary-soft)}`;
document.head.appendChild(css);

let pop=null, open=null, view=null;

function close(){ if(pop){ pop.remove(); pop=null; } if(open){ open.disp.setAttribute('aria-expanded','false'); open=null; } }

function render(){
  const sel=open.hidden.value, today=ymd(new Date());
  const y=view.getFullYear(), m=view.getMonth();
  const first=new Date(y,m,1), start=new Date(y,m,1-first.getDay());
  let cells='';
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i); const s=ymd(d);
    if(i===35 && d.getMonth()!==m) break;
    cells+=`<button type="button" class="tdp-day${d.getMonth()!==m?' out':''}${s===today?' today':''}${s===sel?' sel':''}" data-d="${s}" aria-label="${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()+BE}">${d.getDate()}</button>`;
  }
  pop.innerHTML=`<div class="tdp-head"><button type="button" class="tdp-nav" data-nav="-1" aria-label="เดือนก่อน">‹</button><b>${MONTHS[m]} ${y+BE}</b><button type="button" class="tdp-nav" data-nav="1" aria-label="เดือนถัดไป">›</button></div>
    <div class="tdp-grid">${DOW.map(d=>`<div class="tdp-dow">${d}</div>`).join('')}${cells}</div>
    <div class="tdp-foot"><button type="button" data-clear>ล้าง</button><button type="button" data-today>วันนี้</button></div>`;
}

function place(){
  const r=open.disp.getBoundingClientRect(), w=pop.offsetWidth, h=pop.offsetHeight;
  let left=r.left+scrollX, top=r.bottom+scrollY+6;
  if(r.left+w>innerWidth-16) left=Math.max(16,innerWidth-16-w)+scrollX;
  if(r.bottom+6+h>innerHeight && r.top-6-h>0) top=r.top+scrollY-6-h;
  pop.style.left=left+'px'; pop.style.top=top+'px';
}

function pick(inst,s){ inst.hidden.value=s; inst.hidden.dispatchEvent(new Event('change',{bubbles:true})); inst.hidden.dispatchEvent(new Event('input',{bubbles:true})); }

function openFor(inst){
  if(open===inst){ close(); return; }
  close(); open=inst;
  view=parse(inst.hidden.value)||new Date(); view=new Date(view.getFullYear(),view.getMonth(),1);
  pop=document.createElement('div'); pop.className='tdp'; pop.setAttribute('role','dialog'); pop.setAttribute('aria-label','เลือกวันที่');
  pop.addEventListener('mousedown',e=>e.preventDefault());
  pop.addEventListener('click',e=>{
    const t=e.target.closest('button'); if(!t) return;
    if(t.dataset.nav){ view.setMonth(view.getMonth()+ +t.dataset.nav); render(); place(); return; }
    if(t.dataset.d){ pick(inst,t.dataset.d); close(); inst.disp.focus(); return; }
    if(t.hasAttribute('data-today')){ pick(inst,ymd(new Date())); close(); inst.disp.focus(); return; }
    if(t.hasAttribute('data-clear')){ pick(inst,''); close(); inst.disp.focus(); }
  });
  document.body.appendChild(pop); render(); place();
  inst.disp.setAttribute('aria-expanded','true');
}

function upgrade(el){
  if(el.dataset.thai) return; el.dataset.thai='1';
  const disp=document.createElement('input');
  disp.type='text'; disp.readOnly=true; disp.className=(el.className+' tdate').trim();
  disp.placeholder='วว/ดด/ปปปป'; disp.setAttribute('inputmode','none'); disp.setAttribute('aria-haspopup','dialog');
  if(el.id) disp.id=el.id+'-th';
  const init=el.value;
  el.type='hidden';
  el.after(disp);
  const inst={hidden:el,disp};
  Object.defineProperty(el,'value',{configurable:true,
    get(){ return NATIVE.get.call(el); },
    set(v){ NATIVE.set.call(el,v); disp.value=show(v); if(open===inst) render(); }});
  el.value=init;
  disp.addEventListener('click',()=>openFor(inst));
  disp.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '||e.key==='ArrowDown'){ e.preventDefault(); openFor(inst); }
    else if(e.key==='Escape') close();
    else if((e.key==='Backspace'||e.key==='Delete') && el.value){ e.preventDefault(); pick(inst,''); }
  });
}

document.addEventListener('mousedown',e=>{ if(pop && !pop.contains(e.target) && e.target!==(open&&open.disp)) close(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') close(); });
addEventListener('resize',()=>{ if(pop) place(); });

const scan=root=>root.querySelectorAll && root.querySelectorAll('input[type=date]').forEach(upgrade);
scan(document);
new MutationObserver(ms=>{
  for(const m of ms) m.addedNodes.forEach(n=>{ if(n.nodeType!==1) return; if(n.matches('input[type=date]')) upgrade(n); else scan(n); });
  if(open && !document.body.contains(open.disp)) close();
}).observe(document.body,{childList:true,subtree:true});
})();

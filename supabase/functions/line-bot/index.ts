// =====================================================================
// line-bot : Edge Function สำหรับระบบจองรถ
//   1) รับ Webhook จาก LINE (ตรวจลายเซ็น x-line-signature)
//        /ตั้งกลุ่มคนขับ 123456   เชื่อมกลุ่มนี้เป็นกลุ่มพนักงานขับรถ
//        /ตั้งผู้ดูแล 123456      เชื่อมแชทนี้ให้รับแจ้งเตือนผู้ดูแล
//        /งานวันนี้  /งานพรุ่งนี้   ตอบสรุปงาน (ตอบกลับฟรี ไม่กินโควตา)
//        /ช่วยเหลือ
//   2) {"action":"flush"}  ส่งข้อความที่รอในคิว line_outbox (ฐานข้อมูลเรียกเอง)
//   3) {"action":"status"} ข้อมูลบอทและโควตา (เฉพาะผู้ดูแลที่ล็อกอิน)
//
// Secrets ที่ต้องตั้ง: LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET
// ต้องปิด "Verify JWT" ของฟังก์ชันนี้ เพราะ LINE ส่ง JWT มาไม่ได้
// =====================================================================
const TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const SECRET = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";

function serviceKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const o = JSON.parse(raw);
      const v = o.default ?? Object.values(o)[0];
      if (typeof v === "string" && v) return v;
    } catch { /* ใช้คีย์แบบเก่าแทน */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
// เรียกฐานข้อมูลผ่าน REST โดยตรง (ไม่โหลดไลบรารี ทำให้ฟังก์ชันตื่นเร็ว ทันเวลาที่ LINE รอ)
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = serviceKey();
function dbHeaders(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { apikey: KEY, "Content-Type": "application/json", ...extra };
  if (KEY.startsWith("eyJ")) h.Authorization = `Bearer ${KEY}`;
  return h;
}
async function rpc(fn: string, args: Record<string, unknown> = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: dbHeaders(), body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`DB ${fn} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return await r.json();
}
// deno-lint-ignore no-explicit-any
async function selectOne(table: string, query: string): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { headers: dbHeaders({ Accept: "application/vnd.pgrst.object+json" }) });
  return r.ok ? await r.json() : null;
}
async function patch(table: string, query: string, body: Record<string, unknown>) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { method: "PATCH", headers: dbHeaders({ Prefer: "return=minimal" }), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`DB update ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const HELP = [
  "🚗 บอทแจ้งงานระบบจองรถ",
  "",
  "/งานวันนี้ – สรุปงานขับรถวันนี้",
  "/งานพรุ่งนี้ – สรุปงานขับรถพรุ่งนี้",
  "/ตั้งกลุ่มคนขับ รหัส – เชื่อมกลุ่มนี้เป็นกลุ่มพนักงานขับรถ",
  "/ตั้งผู้ดูแล รหัส – เชื่อมแชทนี้ให้รับแจ้งเตือนผู้ดูแล",
  "",
  "รหัส 6 หลักสร้างได้ที่หน้าเว็บ เมนู แจ้งงานกลุ่ม LINE (เฉพาะผู้ดูแล)",
].join("\n");

// ---------- LINE API ----------
async function lineApi(path: string, init: RequestInit = {}) {
  const r = await fetch("https://api.line.me" + path, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`LINE ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : {};
}
function toMessages(text: string) {
  // LINE จำกัด 5,000 ตัวอักษรต่อข้อความ และ 5 ข้อความต่อครั้ง
  const parts: string[] = [];
  let cur = "";
  for (const block of text.split("\n\n")) {
    const add = cur ? cur + "\n\n" + block : block;
    if (add.length > 4800 && cur) { parts.push(cur); cur = block; } else cur = add;
  }
  if (cur) parts.push(cur);
  return parts.slice(0, 5).map((t) => ({ type: "text", text: t.slice(0, 5000) }));
}
const push = (to: string, text: string) =>
  lineApi("/v2/bot/message/push", { method: "POST", body: JSON.stringify({ to, messages: toMessages(text) }) });
const reply = (replyToken: string, text: string) =>
  lineApi("/v2/bot/message/reply", { method: "POST", body: JSON.stringify({ replyToken, messages: toMessages(text) }) });

async function validSignature(body: string, sig: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// deno-lint-ignore no-explicit-any
async function chatName(src: any): Promise<string> {
  try {
    if (src.groupId) return (await lineApi(`/v2/bot/group/${src.groupId}/summary`)).groupName ?? "กลุ่ม LINE";
    if (src.userId && !src.roomId) return (await lineApi(`/v2/bot/profile/${src.userId}`)).displayName ?? "ผู้ใช้ LINE";
  } catch { /* ไม่มีสิทธิ์อ่านชื่อ */ }
  return src.roomId ? "ห้องแชท LINE" : "แชท LINE";
}

// ---------- Webhook ----------
// deno-lint-ignore no-explicit-any
async function handleEvent(ev: any) {
  const src = ev.source ?? {};
  const target: string | undefined = src.groupId ?? src.roomId ?? src.userId;
  if (!target || !ev.replyToken) return;

  if (ev.type === "join") {
    return reply(ev.replyToken, "สวัสดีครับ 🚗 บอทแจ้งงานระบบจองรถ\n\nให้ผู้ดูแลระบบสร้างรหัสที่หน้าเว็บ แล้วพิมพ์ในกลุ่มนี้:\n/ตั้งกลุ่มคนขับ รหัส6หลัก");
  }
  if (ev.type === "follow") {
    return reply(ev.replyToken, "สวัสดีครับ 🚗 บอทแจ้งงานระบบจองรถ\n\nถ้าคุณเป็นผู้ดูแลระบบ ให้สร้างรหัสที่หน้าเว็บ แล้วพิมพ์:\n/ตั้งผู้ดูแล รหัส6หลัก\n\nพิมพ์ /ช่วยเหลือ เพื่อดูคำสั่งทั้งหมด");
  }
  if (ev.type !== "message" || ev.message?.type !== "text") return;

  const text = String(ev.message.text).trim().replace(/\s+/g, " ");
  const pair = text.match(/^\/ตั้ง(กลุ่มคนขับ|ผู้ดูแล) ?(\d{6})$/);
  if (pair) {
    const kind = pair[1] === "กลุ่มคนขับ" ? "drivers" : "admins";
    const name = await chatName(src);
    const data = await rpc("line_pair", { p_code: pair[2], p_kind: kind, p_target: target, p_name: name });
    return reply(ev.replyToken, data
      ? (kind === "drivers"
          ? `✅ เชื่อม "${name}" เป็นกลุ่มพนักงานขับรถแล้ว\nกลุ่มนี้จะได้รับสรุปงานล่วงหน้าทุกวัน และแจ้งเตือนเมื่องานเปลี่ยน`
          : `✅ เชื่อม "${name}" ให้รับแจ้งเตือนผู้ดูแลแล้ว`)
      : "❌ รหัสไม่ถูกต้องหรือหมดอายุ (รหัสใช้ได้ 30 นาที ครั้งเดียว)\nสร้างรหัสใหม่ได้ที่หน้าเว็บ เมนู แจ้งงานกลุ่ม LINE");
  }

  const jobs = text.match(/^\/งาน(วันนี้|พรุ่งนี้)$/);
  if (jobs) {
    const s = await selectOne("line_settings", "id=eq.1&select=drivers_target,admin_target");
    if (!s || (target !== s.drivers_target && target !== s.admin_target)) {
      return reply(ev.replyToken, "แชทนี้ยังไม่ได้เชื่อมกับระบบจองรถ\nพิมพ์ /ช่วยเหลือ เพื่อดูวิธีเชื่อม");
    }
    const data = await rpc("line_daily_text_rel", { p_offset: jobs[1] === "วันนี้" ? 0 : 1 });
    return reply(ev.replyToken, String(data));
  }

  if (text === "/ช่วยเหลือ" || text.toLowerCase() === "/help") return reply(ev.replyToken, HELP);
}

// ---------- ส่งข้อความในคิว ----------
async function flush() {
  let sent = 0, failed = 0;
  for (let round = 0; round < 5; round++) {
    const data = await rpc("line_claim_outbox");
    if (!data?.length) break;
    for (const m of data as { id: number; target: string | null; body: string }[]) {
      if (!m.target) continue;
      try {
        await push(m.target, m.body);
        await patch("line_outbox", `id=eq.${m.id}`, { status: "sent", sent_at: new Date().toISOString(), error: null });
        sent++;
      } catch (e) {
        await patch("line_outbox", `id=eq.${m.id}`, { status: "failed", error: String(e).slice(0, 500) });
        failed++;
      }
    }
  }
  return { sent, failed };
}

// ---------- สถานะ (เฉพาะผู้ดูแล) ----------
async function status(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
  const ur = jwt ? await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${jwt}` } }) : null;
  const user = ur && ur.ok ? await ur.json() : null;
  if (!user?.id) return json({ error: "ต้องเข้าสู่ระบบ" }, 401);
  const p = await selectOne("profiles", `id=eq.${user.id}&select=role`);
  if (p?.role !== "admin") return json({ error: "เฉพาะผู้ดูแลระบบ" }, 403);

  const out: Record<string, unknown> = { tokenSet: !!TOKEN, secretSet: !!SECRET };
  if (!TOKEN) return json(out);
  try { out.bot = await lineApi("/v2/bot/info"); } catch (e) { out.botError = String(e); }
  try { out.quota = await lineApi("/v2/bot/message/quota"); } catch { /* ignore */ }
  try { out.consumption = await lineApi("/v2/bot/message/quota/consumption"); } catch { /* ignore */ }
  const s = await selectOne("line_settings", "id=eq.1&select=drivers_target");
  if (s?.drivers_target?.startsWith("C")) {
    try { out.driversMembers = (await lineApi(`/v2/bot/group/${s.drivers_target}/members/count`)).count; } catch { /* ignore */ }
  }
  return json(out);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: true, name: "line-bot" });

  const body = await req.text();
  const sig = req.headers.get("x-line-signature");
  try {
    if (sig) {
      if (!SECRET || !(await validSignature(body, sig))) return json({ error: "invalid signature" }, 401);
      const events = JSON.parse(body || "{}").events ?? [];
      // ตอบ LINE ทันที แล้วค่อยทำงานต่อเบื้องหลัง (LINE รอไม่นาน)
      const work = (async () => {
        for (const ev of events) {
          try { await handleEvent(ev); } catch (e) { console.error("event error", e); }
        }
      })();
      // deno-lint-ignore no-explicit-any
      const rt = (globalThis as any).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(work); else await work;
      return json({ ok: true });
    }
    const action = body ? (JSON.parse(body).action ?? "") : "";
    if (action === "flush") return json(await flush());
    if (action === "status") return await status(req);
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

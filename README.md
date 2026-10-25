# ระบบจองใช้รถภายในหน่วยงาน

เว็บจองรถเก๋ง รถกระบะ และรถตู้ของหน่วยงาน ใช้ **GitHub Pages** แสดงหน้าเว็บ และใช้ **Supabase** เก็บข้อมูลและจัดการการเข้าสู่ระบบ

- จองรถ เลือกวัน เวลา และวัตถุประสงค์ ระบบเช็กรถว่างให้ทันที
- ปฏิทินดูได้ทั้งแบบเดือน สัปดาห์ และวัน
- ผู้ดูแลระบบอนุมัติคำขอ จัดพนักงานขับรถ จัดการรถ และกำหนดสิทธิ์ผู้ใช้
- ฐานข้อมูลกันจองรถซ้อนเวลา และกันจัดคนขับคนเดียวลงงานที่ทับกัน
- สรุปงานเป็นข้อความพร้อมส่งเข้ากลุ่ม LINE
- รายงานชั่วโมงใช้รถรายคันและแยกตามฝ่าย

## ไฟล์ในโปรเจกต์

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html`, `styles.css`, `app.js` | หน้าเว็บ |
| `config.js` | URL และ Publishable key ของ Supabase |
| `supabase/schema.sql` | สร้างตาราง สิทธิ์ และกฎกันจองซ้อน |
| `.github/workflows/keepalive.yml` | งานอัตโนมัติกันโปรเจกต์ Supabase ฟรีหยุดทำงาน |

## ติดตั้ง (ทำครั้งเดียว)

### 1. สร้างฐานข้อมูล
Supabase Dashboard → **SQL Editor** → New query → วางเนื้อหาไฟล์ `supabase/schema.sql` ทั้งหมด → **Run**

### 2. ตั้งค่าการเข้าสู่ระบบ
Supabase Dashboard → **Authentication** → **URL Configuration**
- **Site URL**: `https://dc18sagittariuz.github.io/car-reservation/`
- **Redirect URLs**: เพิ่ม `https://dc18sagittariuz.github.io/car-reservation/**`

ถ้าไม่อยากให้ผู้ใช้ต้องยืนยันอีเมล (สะดวกสำหรับใช้ภายในหน่วยงาน) ไปที่ **Authentication → Sign In / Providers → Email** แล้วปิด **Confirm email**
อีเมลระบบของ Supabase แบบฟรีส่งได้จำนวนจำกัดต่อชั่วโมง ถ้ามีคนสมัครพร้อมกันหลายคนแนะนำให้ปิดตัวเลือกนี้

### 3. ตั้งผู้ดูแลระบบคนแรก
สมัครใช้งานผ่านหน้าเว็บก่อน แล้วรันใน SQL Editor:
```sql
update public.profiles set role = 'admin' where email = 'อีเมลของคุณ';
```
จากนั้นออกจากระบบแล้วเข้าใหม่ จะเห็นเมนูผู้ดูแลระบบ ผู้ดูแลคนต่อไปตั้งได้จากเมนู **ผู้ใช้งาน** ในหน้าเว็บ

### 4. เปิด GitHub Pages
Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main` / `(root)` → Save

### 5. ทดสอบงาน keep-alive
Repo → แท็บ **Actions** → **Supabase keep-alive** → **Run workflow** ถ้าขึ้นเครื่องหมายถูกสีเขียวแปลว่าใช้ได้
งานนี้จะเรียกฐานข้อมูลทุก 3 วัน และ commit ไฟล์ `.github/heartbeat.txt` เดือนละครั้ง เพื่อไม่ให้ GitHub ปิดงานตั้งเวลาเมื่อ repo ไม่มีความเคลื่อนไหว 60 วัน

## หมายเหตุด้านความปลอดภัย
- `config.js` ใช้ **Publishable key** ซึ่งเปิดเผยได้ สิทธิ์จริงถูกควบคุมด้วย Row Level Security ใน `schema.sql`
- ห้ามใส่ **Secret key** หรือ `service_role` ลงใน repo นี้เด็ดขาด

## ขั้นต่อไป: แชทบอท LINE
สร้าง LINE Official Account + Messaging API แล้วเขียน Supabase Edge Function ส่งสรุปงานวันถัดไปเข้ากลุ่มพนักงานขับรถทุกเย็น

# 💰 นับตังค์ (Nubtang) - Personal Finance Web App

เว็บแอปบันทึกรายรับ-รายจ่าย Full-stack ด้วย **Next.js (App Router)** เชื่อมต่อ **Google Sheets** เป็นฐานข้อมูลหลัก พร้อมระบบอ่านสลิปและซิงค์ข้อมูลอัตโนมัติจาก **Google Drive** ด้วย **Gemini AI OCR**

---

## ✨ จุดเด่นและความสามารถ (Features)

1. **Full-Stack ในโปรเจกต์เดียว:** หน้าบ้าน (UI Dashboard, ค้นหา, กรอง) และหลังบ้าน (API, Google Service, AI Scanner) อยู่ใน Next.js เดียวกัน
2. **Google Sheets เป็น Database + อ่านได้ด้วยตา:** 
   - มี 3 แผ่นงาน: `📊 สรุปยอด`, `📝 รายการทั้งหมด`, `🏷️ หมวดหมู่`
   - ใส่สูตรยอดรวม และปุ่มลิงก์ `=HYPERLINK(..., "ดูสลิป")` กดเปิดดูรูปสลิปจาก Google Drive ได้ทันที
3. **Zero-Touch Slip Sync (ซิงค์สลิปอัตโนมัติ):**
   - มือถือ Android ใช้แอป **FolderSync** ตรวจจับสลิปจากแอปธนาคาร แล้วส่งขึ้นโฟลเดอร์ Google Drive อัตโนมัติ
   - แยกโฟลเดอร์ตามบัญชี: `Nubtang/nubtang_slips/kplus` และ `Nubtang/nubtang_slips/make`
   - ระบบดึงรูปไปให้ **Gemini Flash AI** อ่านยอดเงิน, วันที่, เวลา, หมวดหมู่ และบันทึกลง Google Sheet
4. **Smart Self-Transfer Detection (ตรวจจับการโยกเงินข้ามบัญชี):**
   - เมื่อมีการโอนเงินระหว่างบัญชีตนเอง (K PLUS ⇄ Make by KBank) ระบบจะตรวจจับชื่อผู้รับ
   - ปรับประเภทเป็น `🔄 โอนย้ายเงิน (TRANSFER)` **ไม่นำไปคิดเป็นรายจ่ายหรือรายรับ** ป้องกันยอดเงินบวม
5. **ระบบความปลอดภัย (SQLite Auth):**
   - เก็บผู้ใช้และรหัสผ่านแบบเข้ารหัสใน SQLite บนเครื่อง
   - มีระบบจำกัดการอ่านสลิปซ้ำ (`processed_slips`) ใน SQLite

---

## 🚀 วิธีการติดตั้งและเริ่มใช้งาน (Getting Started)

### 1. ติดตั้ง Dependencies
```bash
npm install
```

### 2. ตั้งค่าไฟล์ Environment Variables
คัดลอกไฟล์ `.env.example` ไปเป็น `.env.local`:
```bash
cp .env.example .env.local
```
แล้วกรอกค่าต่าง ๆ ใน `.env.local`:
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: อีเมลของ Service Account จาก Google Cloud
- `GOOGLE_PRIVATE_KEY`: Private key ของ Service Account (ขึ้นต้นด้วย `-----BEGIN PRIVATE KEY-----`)
- `GOOGLE_SHEET_ID`: ID ของ Google Sheet (ดูได้จาก URL ของ Sheet)
- `GOOGLE_DRIVE_KPLUS_FOLDER_ID`: ID โฟลเดอร์ `kplus` ใน Google Drive
- `GOOGLE_DRIVE_MAKE_FOLDER_ID`: ID โฟลเดอร์ `make` ใน Google Drive
- `GEMINI_API_KEY`: API Key ฟรีจาก [Google AI Studio](https://aistudio.google.com)
- `OWN_ACCOUNT_NAMES`: ชื่อ-นามสกุลของคุณ หรือชื่อบัญชี (คั่นด้วยจุลภาค) สำหรับตรวจจับสลิปโอนเงินข้ามบัญชี
- `ADMIN_PASSWORD`: รหัสผ่านสำหรับเข้าสู่ระบบ (ค่าเริ่มต้น: `nubtang1234`)
- `KPLUS_ACCOUNT_NO` / `MAKE_ACCOUNT_NO` / `PAOTANG_ACCOUNT_NO`: เลขบัญชี (ใช้ 4 ตัวท้าย, ค่าเริ่มต้น 6651 / 2996 / 9289) ใช้แยกว่า e-Statement `STM_SA<4 ตัวท้าย>_...pdf` เป็นของบัญชีไหน และตรวจจับการโอนระหว่างบัญชีของตัวเอง — Statement ของบัญชีที่ไม่รู้จักจะถูกข้าม **การ์ด LINE ต้องใช้เลขบัญชีเต็ม 10 หลัก** ของ K PLUS และ Make เพราะต้องเทียบหลักที่ 6-9 (`xxx-x-x6665-x`); ถ้าเลขไม่ครบ 10 หลัก การ์ดจะถูกส่งไปรอตรวจสอบ
- `WEBHOOK_SECRET`: รหัสสำหรับ `/api/webhook/notification` และ `/api/webhook/line-card` (ใช้ `Authorization: Bearer`, `x-webhook-secret` หรือ `?key=`)

---

## 📱 วิธีตั้งค่า Google Cloud, Drive และ FolderSync

### ขั้นตอนที่ 1: Google Cloud Console
1. ไปที่ [Google Cloud Console](https://console.cloud.google.com/) แล้วสร้างโปรเจกต์ใหม่ (ฟรี)
2. เปิดใช้งาน 2 APIs:
   - **Google Sheets API**
   - **Google Drive API**
3. ไปที่เมนู **Credentials** -> **Create Credentials** -> เลือก **Service Account**
4. เมื่อสร้างเสร็จ ให้คลิกเข้าไปที่ Service Account นั้น -> ไปที่แท็บ **Keys** -> กด **Add Key** -> **Create new key (JSON)**
5. นำ `client_email` และ `private_key` จากไฟล์ JSON ไปใส่ใน `.env.local`

### ขั้นตอนที่ 2: แชร์สิทธิ์ใน Google Drive & Sheet
1. เปิด **Google Sheet** ของคุณ -> กดปุ่ม **แชร์ (Share)** -> ใส่อีเมลของ Service Account และให้สิทธิ์ **Editor**
2. เปิดโฟลเดอร์ `Nubtang` ใน **Google Drive** -> กด **แชร์ (Share)** -> ใส่อีเมลของ Service Account และให้สิทธิ์ **Editor** เช่นกัน

### ขั้นตอนที่ 3: ตั้งค่าแอป FolderSync บนมือถือ Android
1. ติดตั้งแอป **FolderSync** จาก Google Play Store
2. เพิ่ม Account เป็น Google Drive ของคุณ
3. สร้าง **Folderpair** จำนวน 2 คู่:
   - **คู่ที่ 1 (K PLUS):** เลือกโฟลเดอร์รูปสลิป K PLUS ในมือถือ (มักอยู่ที่ `Pictures/KBank` หรือสลิปธนาคาร) -> ซิงค์ไปยังโฟลเดอร์ `Nubtang/nubtang_slips/kplus` ใน Drive
   - **คู่ที่ 2 (Make):** เลือกโฟลเดอร์รูปสลิป Make by KBank -> ซิงค์ไปยังโฟลเดอร์ `Nubtang/nubtang_slips/make` ใน Drive
4. ตั้งค่าการซิงค์เป็นแบบ **Sync type: To remote folder (One-way)** และเปิด **Sync on file change** หรือตั้งเวลาตามต้องการ

---

## 💻 การรันโปรเจกต์ (Development & Production)

### รันในโหมด Development:
```bash
npm run dev
```
เปิดเบราว์เซอร์ไปที่: `http://localhost:3000`

### รันในโหมด Production:
```bash
npm run build
npm start
```

### รันเทสต์:
เทสต์คือไฟล์ `*.test.ts` ข้างโค้ด ใช้ test runner ของ Node (ต้องเป็น Node ที่รองรับ TypeScript type stripping เช่น Node 22 จาก nodejs.org หรืออิมเมจ `node:22-slim`):
```bash
node --test --experimental-strip-types src/lib/statement/*.test.ts src/lib/balance/*.test.ts src/lib/line/*.test.ts
```

---

## 💬 การ์ด LINE "KBank Live"

มือถือ Android เครื่องเก่าทำหน้าที่เป็น LINE sub device อ่านการ์ดจากแชต "KBank Live" แล้วส่งมาที่แอปทันที:

```
POST /api/webhook/line-card
{ "title": "รายการโอน/ถอน", "date": "9 พ.ย. 69 21:28 น.", "account": "xxx-x-x6665-x",
  "amount": "-150.00 บาท", "balance": "13,698.33 บาท", "messageId": "ไม่บังคับ" }
```

ตอบกลับ `status` เป็น `added`, `attached`, `paired`, `duplicate`, `recovered` หรือ `needs_review` พร้อม `warnings`; ถ้าเขียนไม่สำเร็จจะตอบ 500 ให้มือถือส่งซ้ำได้ (การ์ดเดิมจะไม่เพิ่มแถว)

- **การ์ด → แถวทันที:** เขียนลงชีตด้วย source `LINE` หมวด "รอระบุ" เพื่อให้ยอดถูกต้องแบบเรียลไทม์
- **ไม่ซ้ำ:** ระบุการ์ดด้วย บัญชี + นาที + จำนวนเงิน + ยอดคงเหลือ เก็บใน Postgres (`line_cards`) ส่งซ้ำไม่เพิ่มแถว ส่งพร้อมกันก็ไม่ซ้ำ
- **ยอดคงเหลือไม่ต่อเนื่อง:** บันทึกตามปกติ แต่แจ้งเตือนว่าการ์ดอาจหายไป (แสดงบนหน้ารายการธุรกรรม)
- **โอนระหว่างบัญชี:** การ์ดออกและการ์ดเข้าบัญชีคนละบัญชี ยอดเท่ากัน ภายใน 3 นาที รวมเป็น TRANSFER แถวเดียวบนบัญชีผู้โอน (ถือว่าชั่วคราวจนกว่าจะมีสลิป)
- **การ์ดที่ไม่รู้จัก:** ชื่อการ์ดหรือบัญชีที่ไม่รู้จักจะไม่ลงบัญชี แต่ขึ้นรายการรอตรวจสอบ

### การกระทบกับสลิป
ทุกการซิงค์สลิปจะอ่าน `processed_slips` เพื่อไม่ OCR ซ้ำ แต่ผล OCR ถูกเก็บใน `slip_facts` และนำมากระทบกับแถวจริงทุกรอบ:

- สลิปจับคู่แถว LINE ที่ บัญชี + จำนวนเงิน + เวลา ห่างไม่เกิน 5 นาที (เวลาใกล้สุดก่อน หนึ่งแถวต่อหนึ่งสลิป) แล้ว **อัปเดตแถวเดิม** เป็น source `LINE+SLIP` ไม่เพิ่มแถวใหม่
- **สลิปคือคำตัดสิน:** สลิปโอนเข้าบัญชีตัวเองเปลี่ยน EXPENSE เป็น TRANSFER; สลิปจ่ายคนอื่นยกเลิกการจับคู่ TRANSFER แล้วคืนเป็นสองแถว
- สลิปมาก่อนการ์ด: แถวสลิปอยู่แล้ว การ์ดจะผูกกับแถวนั้นและไม่เพิ่มแถว สลิปที่ไม่มีการ์ดเพิ่มแถวตามเดิม (`AUTO_SYNC`)
- **แถวที่แก้เอง:** ระบบจำลายนิ้วมือ (`line_row_fingerprints`) ของ วันที่/เวลา/ประเภท/จำนวน/หมวด/บัญชี/รายละเอียด ที่เขียนล่าสุด ถ้าแถวไม่ตรงถือว่าเจ้าของแก้แล้ว จะไม่เขียนทับ (ทั้งแก้ในแอปและในชีต) แถว `MANUAL` ไม่ถูกแตะ และสลิปที่ตรงกับแถวที่แก้เองจะไม่ถูกเพิ่มเป็นแถวใหม่
- เงินเข้าที่ไม่มีสลิปคงเป็น "รอระบุ" กรองได้จากตัวเลือก "⏳ รอระบุ" ในหน้ารายการ
- ทุกการเขียนแถวหาแถวจาก id ใหม่และตรวจว่าไม่ถูกแก้ไประหว่างนั้น และงานที่อ่านแล้วเขียนชีตทำทีละงานด้วย Postgres advisory lock

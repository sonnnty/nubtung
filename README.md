# 💰 นับตังค์ (Nubtang) - Personal Finance Web App

เว็บแอปบันทึกรายรับ-รายจ่าย Full-stack ด้วย **Next.js (App Router)** ใช้ **PostgreSQL** เป็นฐานข้อมูลหลัก และทำสำเนาแบบอ่านอย่างเดียวไปที่ **Google Sheets** ให้คนอื่นดูได้ พร้อมระบบอ่านสลิปและซิงค์ข้อมูลอัตโนมัติจาก **Google Drive** ด้วย **Gemini AI OCR**

---

## ✨ จุดเด่นและความสามารถ (Features)

1. **Full-Stack ในโปรเจกต์เดียว:** หน้าบ้าน (UI Dashboard, ค้นหา, กรอง) และหลังบ้าน (API, Google Service, AI Scanner) อยู่ใน Next.js เดียวกัน
2. **Postgres เป็นข้อมูลหลัก + Google Sheet เป็นสำเนาให้ดู:**
   - ทุกการอ่านและเขียนของแอปใช้ Postgres ไม่มีคำขอไหนต้องรอ Google
   - Sheet มี 3 แผ่นงาน: `📊 สรุปยอด`, `📝 รายการทั้งหมด`, `🏷️ หมวดหมู่` อัปเดตเบื้องหลังโดยอัตโนมัติ (ลำดับแถว คอลัมน์ และรูปแบบเหมือนเดิม) พร้อมปุ่มลิงก์ `=HYPERLINK(..., "ดูสลิป")`
   - **อย่าแก้ข้อมูลใน Sheet โดยตรง** การแก้จะถูกเขียนทับ ให้แก้ในเว็บแอปเท่านั้น
3. **Zero-Touch Slip Sync (ซิงค์สลิปอัตโนมัติ):**
   - มือถือ Android ใช้แอป **FolderSync** ตรวจจับสลิปจากแอปธนาคาร แล้วส่งขึ้นโฟลเดอร์ Google Drive อัตโนมัติ
   - แยกโฟลเดอร์ตามบัญชี: `Nubtang/nubtang_slips/kplus` และ `Nubtang/nubtang_slips/make`
   - ระบบดึงรูปไปให้ **Gemini Flash AI** อ่านยอดเงิน, วันที่, เวลา, หมวดหมู่ และบันทึกลง Postgres
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
- `DATABASE_URL`: การเชื่อมต่อ PostgreSQL (ฐานข้อมูลหลัก จำเป็นต้องมี)
- `CRON_SECRET`: รหัสสำหรับ `/api/cron/*` รวมถึงการย้ายข้อมูลและการสร้าง Sheet ใหม่ด้านล่าง
- `ENABLE_SHEET_MIRROR` / `SHEET_MIRROR_INTERVAL_SECONDS`: เปิด/ปิดตัวส่งข้อมูลไป Sheet และรอบการส่ง (ค่าเริ่มต้น `true` และทุก 5 วินาที)
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
node --test --experimental-strip-types src/lib/statement/*.test.ts src/lib/balance/*.test.ts src/lib/line/*.test.ts src/lib/utils/*.test.ts src/lib/summary/*.test.ts src/lib/tax/*.test.ts
```

เทสต์ของ Postgres (การย้ายข้อมูล, การส่งไป Sheet, การเขียนพร้อมกัน) ต้องมี Postgres จริง และใช้ Sheet จำลอง จึงไม่เรียก Google:
```bash
docker run -d --name nubtang-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=nubtang_test -p 5433:5432 postgres:16-alpine
TEST_DATABASE_URL=postgresql://postgres:test@localhost:5433/nubtang_test \
  node --test --test-concurrency=1 --experimental-strip-types src/lib/sheet-mirror/*.pg.test.ts src/lib/db/*.pg.test.ts
docker rm -f nubtang-test-pg
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

- **การ์ด → แถวทันที:** เขียนลง Postgres ด้วย source `LINE` หมวด "รอระบุ" เพื่อให้ยอดถูกต้องแบบเรียลไทม์
- **ไม่ซ้ำ:** ระบุการ์ดด้วย บัญชี + นาที + จำนวนเงิน + ยอดคงเหลือ เก็บใน Postgres (`line_cards`) ส่งซ้ำไม่เพิ่มแถว ส่งพร้อมกันก็ไม่ซ้ำ
- **ยอดคงเหลือไม่ต่อเนื่อง:** บันทึกตามปกติ แต่แจ้งเตือนว่าการ์ดอาจหายไป (แสดงบนหน้ารายการธุรกรรม)
- **โอนระหว่างบัญชี:** การ์ดออกและการ์ดเข้าบัญชีคนละบัญชี ยอดเท่ากัน ภายใน 3 นาที รวมเป็น TRANSFER แถวเดียวบนบัญชีผู้โอน (ถือว่าชั่วคราวจนกว่าจะมีสลิป)
- **การ์ดที่ไม่รู้จัก:** ชื่อการ์ดหรือบัญชีที่ไม่รู้จักจะไม่ลงบัญชี แต่ขึ้นรายการรอตรวจสอบ

### การกระทบกับสลิป
ทุกการซิงค์สลิปจะอ่าน `processed_slips` เพื่อไม่ OCR ซ้ำ แต่ผล OCR ถูกเก็บใน `slip_facts` และนำมากระทบกับแถวจริงทุกรอบ:

- สลิปจับคู่แถว LINE ที่ บัญชี + จำนวนเงิน + เวลา ห่างไม่เกิน 5 นาที (เวลาใกล้สุดก่อน หนึ่งแถวต่อหนึ่งสลิป) แล้ว **อัปเดตแถวเดิม** เป็น source `LINE+SLIP` ไม่เพิ่มแถวใหม่
- **สลิปคือคำตัดสิน:** สลิปโอนเข้าบัญชีตัวเองเปลี่ยน EXPENSE เป็น TRANSFER; สลิปจ่ายคนอื่นยกเลิกการจับคู่ TRANSFER แล้วคืนเป็นสองแถว
- สลิปมาก่อนการ์ด: แถวสลิปอยู่แล้ว การ์ดจะผูกกับแถวนั้นและไม่เพิ่มแถว สลิปที่ไม่มีการ์ดเพิ่มแถวตามเดิม (`AUTO_SYNC`)
- **แถวที่แก้เอง:** การแก้ในเว็บแอปจะถูกบันทึกใน Postgres (`transactions.edited_at`) การกระทบยอดจะไม่เขียนทับแถวเหล่านี้ แถว `MANUAL` ไม่ถูกแตะ และสลิปที่ตรงกับแถวที่แก้เองจะไม่ถูกเพิ่มเป็นแถวใหม่
- เงินเข้าที่ไม่มีสลิปคงเป็น "รอระบุ" กรองได้จากตัวเลือก "⏳ รอระบุ" ในหน้ารายการ
- งานที่อ่านแล้วเขียนรายการทำทีละงานด้วย Postgres advisory lock และทั้งงานอยู่ใน DB transaction เดียว (พร้อมรายการที่จะส่งไป Sheet)

### ยอดคงเหลือ ส่วนต่างจากธนาคาร และรายการปรับจำนวนเงิน
ยอดของ K PLUS และ Make by KBank ที่แสดงบนแดชบอร์ดมาจากการ์ด "KBank Live" ใบล่าสุด (`line_cards`) ส่วนยอดในสมุดบัญชี (ledger) คำนวณจากยอดตั้งต้น/ยอดยกไปของ e-statement + รายการที่ลงวันที่ถึงนาทีของการ์ดใบนั้น (`computeAccountBalancesWithCards` ใน `src/lib/balance/account-balances.ts`) **ส่วนต่าง = ledger − ยอดการ์ด** ถ้าไม่เป็น 0 แดชบอร์ดจะขึ้น "ข้อมูลในระบบมากกว่า/น้อยกว่าธนาคาร"

ถ้าไม่อยากตามหาทุกแถวที่ตกหล่น กดปุ่ม **"ปรับยอดให้ตรงธนาคาร"** ข้างป้ายส่วนต่างนั้น (ยืนยันก่อนเพิ่ม) ระบบจะเพิ่มแถว **รายการปรับจำนวนเงิน** หนึ่งแถว (`POST /api/transactions/balance-adjustment` body `{ "account": "K PLUS" }`):

- ประเภท INCOME เมื่อ ledger ต่ำกว่าธนาคาร, EXPENSE เมื่อสูงกว่า จำนวนเงิน = |ส่วนต่าง| คำนวณใหม่ฝั่งเซิร์ฟเวอร์จาก DB ภายใต้ ledger lock (ไม่รับจำนวนเงินจากหน้าเว็บ) ถ้าส่วนต่างเป็น 0 ไม่เพิ่มอะไร จึงกดซ้ำได้โดยไม่เพิ่มแถว
- หมวด `ปรับยอดเงิน` (ค่าคงที่ `BALANCE_ADJUSTMENT_CATEGORY` ใน `src/lib/balance/balance-adjustment.ts`) วัน-เวลาเท่ากับการ์ดใบล่าสุด (แถวที่นาทีเดียวกับ cutoff นับรวม จึงปิดส่วนต่างได้พอดี) source `MANUAL` หมายเหตุ `รายการปรับจำนวนเงิน: ให้ยอดตรงกับธนาคาร (KBank Live <วัน เวลา> ยอด <ยอดการ์ด>)` เขียนผ่านทางเดียวกับแถวอื่นจึงไปอยู่ในคิวส่งไป Sheet ด้วย
- **ไม่ใช่รายรับ/รายจ่ายจริง:** ไม่นับในรายรับ รายจ่าย สัดส่วนหมวดหมู่ กราฟ สรุป LINE ("สรุป") และรายได้เพื่อคำนวณภาษี แต่ **นับในยอดคงเหลือของบัญชี** ในหน้ารายการยังเห็นพร้อมป้าย "ปรับยอด" และลบได้ (ลบแล้วส่วนต่างกลับมา)
- **การจับคู่ข้ามแถวนี้:** การนำเข้า statement, การกระทบสลิป, การจับคู่การ์ด และการลบรายการซ้ำ จะไม่นับแถวปรับยอดเป็นแถวที่ตรงกับรายการจริง
- **เมื่อมี e-statement ใหม่:** ยอดปิด (ยอดยกไป) ของ statement จะตั้งยอดบัญชีใหม่ ณ สิ้นงวด แถวปรับยอดที่ลงวันที่ **ไม่เกินวันสิ้นงวดของ statement นั้น** จึงหยุดมีผลต่อยอด (เป็นไปตามที่ตั้งใจ เพราะ statement คือยอดจริงของธนาคารแล้ว) แถวยังอยู่ในรายการเพื่อการตรวจย้อนหลัง
- ข้อควรระวัง: ถ้าภายหลังมีแถวจริงที่ตกหล่น (วันที่ก่อนการ์ดใบนั้น) ถูกเพิ่มเข้ามา ส่วนต่างจะกลับมา (แถวปรับยอดเดิมนับซ้ำกับแถวนั้น) ให้ลบแถวปรับยอดเดิมหรือกดปรับยอดอีกครั้ง

---

## 🗄️ Postgres กับ Google Sheet

- `transactions` และ `tax_profiles` ใน Postgres คือข้อมูลจริง Sheet เป็นสำเนาทางเดียว: การแก้ใน Sheet โดยตรงอาจถูกเขียนทับ
- ทุกการเขียนบันทึกการเปลี่ยนแปลงลง `sheet_outbox` ใน transaction เดียวกับแถว ตัวส่งเบื้องหลัง (`src/lib/sheet-mirror/worker.ts`) อ่านคิวตามลำดับและส่งสถานะล่าสุดของแต่ละแถวตาม id จึงส่งซ้ำได้ไม่ซ้ำแถว ถ้า Google ล่มหรือติดโควตาจะลองใหม่แบบเว้นระยะ (30 วินาทีถึง 30 นาที) และคงคิวไว้แม้รีสตาร์ท
- บนแถบเมนูแสดงเวลาที่ส่งไป Sheet ล่าสุด และขึ้นเตือนสีเหลืองเมื่อส่งไม่สำเร็จหรือคิวค้างเกิน 15 นาที

### ขั้นตอนขึ้นระบบ (ทำครั้งเดียวก่อนใช้งาน)

ถ้ายังไม่ย้ายข้อมูล แอปจะตอบข้อผิดพลาดพร้อมบอกให้รันขั้นตอนนี้ ไม่แสดงบัญชีว่างเปล่า และจะไม่เขียนอะไรลง Sheet

1. สำรอง Sheet: ใน Google Sheets เลือก **File > Make a copy**
2. ใน `.env.local` ต้องมี `DATABASE_URL`, `CRON_SECRET` และค่า Google ครบ และ Service Account เป็น Editor ของ Sheet
3. **หยุดแอปเวอร์ชันเดิม** ให้ Sheet ไม่เปลี่ยนระหว่างย้าย (ระหว่างนี้การ์ด LINE ที่ส่งมาจะตอบ 500 และมือถือส่งซ้ำเอง)
4. ติดตั้งและเปิดแอปเวอร์ชันนี้
5. สั่งย้ายข้อมูล แล้วใช้ `jobId` ที่ได้ถามผล:
   ```bash
   curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" https://<โดเมน>/api/cron/sheet-migrate
   curl -s -H "Authorization: Bearer $CRON_SECRET" "https://<โดเมน>/api/cron/sheet-migrate?jobId=<jobId>"
   ```
   รอจน `status` เป็น `done` แล้วดู `result`: จำนวนแถว ยอดรวมแต่ละบัญชี (`accounts`) และรายการที่อ่านวันที่/เวลาไม่ได้ (`warnings`)
6. ถ้าได้ `status: error` (HTTP 500) ข้อความจะบอกสาเหตุ เช่น รหัสรายการซ้ำ หรือ Sheet เปลี่ยนระหว่างย้าย: Postgres จะไม่ถูกแก้เลย แก้ตามที่บอกแล้วทำข้อ 5 ซ้ำได้
7. เปิดเว็บแอป ตรวจยอดกับ Sheet ที่สำรองไว้ และดูว่าแถบเมนูแสดงเวลาล่าสุดโดยไม่มีคำเตือน
8. เพิ่มรายการทดสอบในเว็บแอป ดูว่าโผล่ใน Sheet ภายในไม่กี่วินาที แล้วลบรายการนั้น

รันซ้ำได้ปลอดภัย: ก่อนแอปเขียนข้อมูลครั้งแรกจะดึงจาก Sheet ใหม่ทั้งหมด หลังจากนั้นจะไม่นำเข้าซ้ำและไม่เปลี่ยนอะไร

หลังใช้งานไประยะหนึ่ง ตาราง `line_row_fingerprints` ไม่ถูกใช้แล้ว ลบได้เมื่อมั่นใจว่าไม่ต้องย้ายข้อมูลซ้ำ

### ซ่อม Sheet จาก Postgres

เขียนแท็บรายการและแท็บภาษีใหม่ทั้งหมดจาก Postgres (ไม่ล้างแท็บก่อน ผู้ดูจึงไม่เห็นแท็บว่าง):
```bash
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" https://<โดเมน>/api/cron/sheet-rebuild
curl -s -H "Authorization: Bearer $CRON_SECRET" "https://<โดเมน>/api/cron/sheet-rebuild?jobId=<jobId>"
```

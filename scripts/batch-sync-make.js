const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());

const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/genai');
const { Pool } = require('pg');
const path = require('path');
const { appendTransactions } = require('./lib/append-transactions');

// 1. Initialize PostgreSQL
if (!process.env.DATABASE_URL) {
  console.error('[Batch Sync] DATABASE_URL environment variable is required.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 2. Initialize Google Drive & Sheets
const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
let key = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
const auth = new google.auth.JWT({
  email,
  key,
  scopes: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets',
  ],
});
const drive = google.drive({ version: 'v3', auth });

// 3. Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const CONCURRENCY = 6; // Stable concurrency for Google rate limits
const BATCH_FLUSH_SIZE = 20; // Write to Postgres every 20 slips

function timeoutPromise(ms, promise, errMsg = 'Operation timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(errMsg)), ms)),
  ]);
}

async function fetchUnprocessedFiles(folderId) {
  const resSlips = await pool.query('SELECT drive_file_id FROM processed_slips');
  const processedSlips = new Set(resSlips.rows.map(r => r.drive_file_id));

  const files = [];
  let pageToken = undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink, createdTime)',
      pageSize: 1000,
      pageToken,
    });
    for (const f of res.data.files || []) {
      if (!processedSlips.has(f.id)) {
        files.push(f);
      }
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return files;
}

async function analyzeMakeSlip(base64Image, mimeType) {
  const prompt = `
You are an expert Thai banking slip OCR assistant.
Analyze this Make by KBank Thai banking slip image.

Make by KBank uses distinct Cloud Pocket theme colors in the top background / top gradient / clouds banner to represent spending categories:
- Orange (สีส้ม / ส้มอมเหลือง) -> Category: 'อาหารและเครื่องดื่ม'
- Red (สีแดง) -> Category: 'ช้อปปิ้ง'
- Yellow (สีเหลืองทอง) -> Category: 'การเดินทาง/ค่าน้ำมัน' (น้ำมัน)
- Dark Green (สีเขียวเข้ม) -> Category: 'การเดินทาง/ค่าน้ำมัน' (เดินทาง/รถ)
- Pink (สีชมพู) -> Category: 'ของใช้ในบ้าน/ซูเปอร์' (ค่าซักผ้า)
- Purple (สีม่วง) -> Category: 'สาธารณูปโภค (น้ำ/ไฟ/เน็ต)' (ค่าห้อง)
- Light Green (สีเขียวอ่อน) -> Category: 'สาธารณูปโภค (น้ำ/ไฟ/เน็ต)' (จ่ายบิล)

Identify:
1. Amount (pure number)
2. Date (YYYY-MM-DD in AD, convert BE to AD if needed)
3. Time (HH:mm:ss)
4. Receiver Name
5. Theme Color / Cloud Pocket Color (ORANGE, RED, YELLOW, DARK_GREEN, PINK, PURPLE, LIGHT_GREEN, STANDARD)
6. Suggested Category

Output JSON:
{
  "amount": number,
  "date": "YYYY-MM-DD",
  "time": "HH:mm:ss",
  "receiverName": "string",
  "themeColor": "string",
  "suggestedCategory": "string",
  "note": "string"
}
`;

  const aiCall = ai.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { data: base64Image, mimeType } },
        ],
      },
    ],
  });

  const response = await timeoutPromise(12000, aiCall, 'Gemini OCR timeout');

  const rawText = response.text?.trim() || '{}';
  const cleanedJson = rawText.replace(/^```(json)?/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(cleanedJson);

  const receiver = (parsed.receiverName || '').toLowerCase();
  const note = (parsed.note || '').toLowerCase();

  // Self transfer check (Only user himself: วรโชติ)
  const isSelf = receiver.includes('วรโชติ') || receiver.includes('worachot');

  let category = parsed.suggestedCategory || 'อื่นๆ';
  const theme = (parsed.themeColor || '').toUpperCase();

  if (theme === 'ORANGE') category = 'อาหารและเครื่องดื่ม';
  else if (theme === 'RED') category = 'ช้อปปิ้ง';
  else if (theme === 'YELLOW' || theme === 'DARK_GREEN') category = 'การเดินทาง/ค่าน้ำมัน';
  else if (theme === 'PINK') category = 'ของใช้ในบ้าน/ซูเปอร์';
  else if (theme === 'PURPLE' || theme === 'LIGHT_GREEN') category = 'สาธารณูปโภค (น้ำ/ไฟ/เน็ต)';

  let type = 'EXPENSE';
  if (isSelf) {
    type = 'TRANSFER';
    category = 'โอนระหว่างบัญชี';
  }

  return {
    amount: Number(parsed.amount) || 0,
    date: parsed.date || new Date().toISOString().split('T')[0],
    time: parsed.time || '12:00:00',
    type,
    category,
    note: parsed.note || parsed.receiverName || 'สลิปโอนเงิน Make',
  };
}

async function run() {
  const folderId = process.env.GOOGLE_DRIVE_MAKE_FOLDER_ID;
  console.log(`[Batch Processor] 🔍 Fetching remaining Make by KBank slips from folder ${folderId}...`);

  const unprocessed = await fetchUnprocessedFiles(folderId);
  console.log(`[Batch Processor] 🚀 Found ${unprocessed.length} slips remaining to process with Concurrency=${CONCURRENCY}...`);

  if (unprocessed.length === 0) {
    console.log('[Batch Processor] ✅ All slips already processed!');
    return;
  }

  let successCount = 0;
  let failCount = 0;
  const pendingRows = [];

  const markProcessed = async (fileId, account, amount, date, status) => {
    await pool.query(
      `INSERT INTO processed_slips (drive_file_id, account, amount, transaction_date, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (drive_file_id) DO UPDATE SET
         account = EXCLUDED.account,
         amount = EXCLUDED.amount,
         transaction_date = EXCLUDED.transaction_date,
         status = EXCLUDED.status`,
      [fileId, account, amount != null ? amount : null, date || null, status]
    );
  };

  const startTime = Date.now();
  const totalItems = unprocessed.length;

  for (let i = 0; i < unprocessed.length; i += CONCURRENCY) {
    const chunk = unprocessed.slice(i, i + CONCURRENCY);

    await Promise.all(
      chunk.map(async (file) => {
        try {
          const downloadCall = drive.files.get(
            { fileId: file.id, alt: 'media' },
            { responseType: 'arraybuffer' }
          );
          const res = await timeoutPromise(10000, downloadCall, 'Drive download timeout');
          const base64 = Buffer.from(res.data).toString('base64');
          const mimeType = file.mimeType || 'image/jpeg';

          const data = await analyzeMakeSlip(base64, mimeType);

          const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const slipLink = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;

          let typeLabel = '🔴 รายจ่าย';
          if (data.type === 'INCOME') typeLabel = '🟢 รายรับ';
          else if (data.type === 'TRANSFER') typeLabel = '🔄 โอนย้ายเงิน';

          pendingRows.push([
            data.date,
            data.time,
            typeLabel,
            data.amount,
            data.category,
            'Make by KBank',
            data.note,
            slipLink,
            txId,
            file.id,
            'AUTO_SYNC',
          ]);

          await markProcessed(file.id, 'Make by KBank', data.amount, data.date, 'SUCCESS');
          successCount++;
        } catch (err) {
          failCount++;
          console.error(`[Skip/Retry-later] file ${file.name}: ${err.message}`);
          await markProcessed(file.id, 'Make by KBank', 0, '', 'FAILED');
        }
      })
    );

    // Periodic flush to Postgres
    if (pendingRows.length >= BATCH_FLUSH_SIZE || i + CONCURRENCY >= unprocessed.length) {
      const toFlush = pendingRows.splice(0, pendingRows.length);
      if (toFlush.length > 0) {
        // A failure stops the run: these slips are already marked processed and would be lost
        await appendTransactions(pool, toFlush);
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const percent = Math.min(100, Math.round(((i + chunk.length) / totalItems) * 100));
        console.log(`[Progress] ⚡ ${i + chunk.length}/${totalItems} (${percent}%) | Flushed ${toFlush.length} rows | Elapsed: ${elapsedSec}s`);
      }
    }
  }

  console.log(`[Batch Processor] 🎉 COMPLETE! Successfully processed ${successCount} slips (${failCount} failed).`);
}

run().catch(console.error);

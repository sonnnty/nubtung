import { messagingApi } from '@line/bot-sdk';
import { appendTransactionRow, getAllTransactions, ensureSheetStructure } from '@/lib/google/sheets';
import { analyzeSlipImage } from '@/lib/ai/gemini-slip-ocr';
import { checkRecentTransferDuplicate, recordTransferSlip } from '@/lib/db';
import { Transaction, TransactionType } from '@/types';
import { getBangkokDateString, getBangkokTimeString } from '@/lib/utils/date';

export function getLineClient() {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
  return new messagingApi.MessagingApiClient({
    channelAccessToken,
  });
}

export function getLineBlobClient() {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
  return new messagingApi.MessagingApiBlobClient({
    channelAccessToken,
  });
}

/**
 * Handle incoming LINE Webhook events
 */
export async function handleLineEvent(event: any) {
  if (event.type !== 'message') return;

  const replyToken = event.replyToken;
  const message = event.message;

  // Only the owner's LINE account may read balances or record transactions
  const allowedUserIds = (process.env.LINE_ALLOWED_USER_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const userId: string | undefined = event.source?.userId;
  if (!userId || !allowedUserIds.includes(userId)) {
    console.warn(`[LINE] Rejected message from unlisted userId: ${userId}`);
    await getLineClient().replyMessage({
      replyToken,
      messages: [{
        type: 'text',
        text: `⛔ บัญชีนี้ไม่ได้รับอนุญาต\nถ้าเป็นเจ้าของ ให้เพิ่ม LINE_ALLOWED_USER_IDS=${userId ?? ''} ใน .env.local`,
      }],
    });
    return;
  }

  if (message.type === 'text') {
    await handleTextMessage(replyToken, message.text);
  } else if (message.type === 'image') {
    await handleImageMessage(replyToken, message.id);
  }
}

/**
 * Process text messages (KBank Live forward, manual expenses, or commands)
 */
async function handleTextMessage(replyToken: string, text: string) {
  const client = getLineClient();
  const trimmed = text.trim();

  // 1. Command: "สรุป" or "ยอดคงเหลือ"
  if (/^(สรุป|ยอดคงเหลือ|ดูยอด|ภาพรวม|balance|summary)$/i.test(trimmed)) {
    const allTxs = await getAllTransactions();
    let income = 0;
    let expense = 0;

    for (const tx of allTxs) {
      if (tx.type === 'INCOME') income += tx.amount;
      else if (tx.type === 'EXPENSE') expense += tx.amount;
    }

    const net = income - expense;
    const replyText = `📊 สรุปยอดการเงินล่าสุด (นับตังค์)\n` +
      `━━━━━━━━━━━━━━━\n` +
      `🟢 รายรับรวม: ฿${income.toLocaleString('th-TH', { minimumFractionDigits: 2 })}\n` +
      `🔴 รายจ่ายรวม: ฿${expense.toLocaleString('th-TH', { minimumFractionDigits: 2 })}\n` +
      `━━━━━━━━━━━━━━━\n` +
      `💰 คงเหลือสุทธิ: ฿${net.toLocaleString('th-TH', { minimumFractionDigits: 2 })}\n` +
      `📝 รายการทั้งหมด: ${allTxs.length} รายการ`;

    await client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: replyText }],
    });
    return;
  }

  // 2. KBank Live / Bank notification forwarded message
  const isKbankLive = /เข้าบัญชี|ออกจากบัญชี|โอนเงิน|ชำระเงิน|รับโอน|kbank|k plus|make/i.test(trimmed);

  if (isKbankLive) {
    const kplusFull = process.env.KPLUS_ACCOUNT_NO || '0568966651';
    const makeFull = process.env.MAKE_ACCOUNT_NO || '1183962996';
    const kplusLast4 = kplusFull.slice(-4); // 6665
    const makeLast4 = makeFull.slice(-4);   // 6299

    // Extract amount
    const amountMatch = trimmed.match(/(?:จำนวน|ยอดเงิน|เงินเข้า|เงินออก|ชำระ|โอน)?\s*([\d,]+\.?\d*)\s*(?:บาท|THB)?/i);
    let amount = 0;
    if (amountMatch && amountMatch[1]) {
      amount = parseFloat(amountMatch[1].replace(/,/g, '')) || 0;
    }

    if (amount > 0) {
      let account = 'K PLUS';
      const hasKplus = trimmed.includes(kplusLast4) || trimmed.includes(kplusFull);
      const hasMake = trimmed.includes(makeLast4) || trimmed.includes(makeFull) || /make/i.test(trimmed);

      if (hasMake && !hasKplus) account = 'Make by KBank';
      else if (hasKplus) account = 'K PLUS';

      const ownNamesConfig = process.env.OWN_ACCOUNT_NAMES || 'วรโชติ,worachot';
      const ownNames = ownNamesConfig.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const isBothAccounts = hasKplus && hasMake;
      const isSelfReceiver = ownNames.some(name => {
        const rx = new RegExp(`(?:ไปยัง|โอนให้|เข้าบัญชี|เข้ากระเป๋า|to)\\s*[^\\n]*?${name}`, 'i');
        return rx.test(trimmed);
      }) || /โอนเข้าเป๋าตัง|g-wallet/i.test(trimmed);
      const isSelfTransfer = isBothAccounts || isSelfReceiver;

      let type: TransactionType = 'EXPENSE';
      const isIncomeText = /เงินเข้า|รับโอน|ฝากเงิน|credit|deposit/i.test(trimmed);

      if (isSelfTransfer) type = 'TRANSFER';
      else if (isIncomeText) type = 'INCOME';

      // Deduplicate transfer if 2nd notification
      if (type === 'TRANSFER') {
        const isDuplicate = await checkRecentTransferDuplicate(amount, 3);
        if (isDuplicate) {
          await client.replyMessage({
            replyToken,
            messages: [{
              type: 'text',
              text: `🔄 รายการโอนย้ายเงิน ฿${amount.toLocaleString()} ระหว่างบัญชีตัวเองถูกบันทึกไปแล้วครับ (ข้ามการบันทึกซ้ำ)`,
            }],
          });
          return;
        }
      }

      let category = 'อื่นๆ';
      if (type === 'TRANSFER') category = 'โอนระหว่างบัญชี';
      else if (type === 'INCOME') category = 'เงินเดือน/รายรับ';
      else {
        const lower = trimmed.toLowerCase();
        if (/shopee|lazada|tiktok|edc/i.test(lower)) category = 'ช้อปปิ้ง';
        else if (/ปตท|ptt|บางจาก|shell|น้ำมัน|ทางด่วน/i.test(lower)) category = 'การเดินทาง/ค่าน้ำมัน';
        else if (/เซเว่น|7-eleven|lotus|big c|cj/i.test(lower)) category = 'ของใช้ในบ้าน/ซูเปอร์';
        else if (/ไฟฟ้า|ประปา|ais|true|dtac|เน็ต/i.test(lower)) category = 'สาธารณูปโภค (น้ำ/ไฟ/เน็ต)';
        else if (/อาหาร|กาแฟ|cafe|amazon|กะเพรา/i.test(lower)) category = 'อาหารและเครื่องดื่ม';
      }

      const dateStr = getBangkokDateString();
      const timeStr = getBangkokTimeString();
      const txId = `line_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      const newTx: Transaction = {
        id: txId,
        date: dateStr,
        time: timeStr,
        type,
        amount,
        category,
        account,
        note: `LINE: ${trimmed.substring(0, 80)}`,
        source: 'AUTO_SYNC',
        createdAt: new Date().toISOString(),
      };

      await ensureSheetStructure();
      await appendTransactionRow(newTx);

      if (type === 'TRANSFER') {
        await recordTransferSlip(txId, account, amount, dateStr);
      }

      const emoji = type === 'INCOME' ? '🟢' : type === 'TRANSFER' ? '🔄' : '🔴';
      const label = type === 'INCOME' ? 'รายรับ' : type === 'TRANSFER' ? 'โอนย้ายเงิน' : 'รายจ่าย';

      await client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `✅ บันทึกรายการสำเร็จ!\n` +
            `━━━━━━━━━━━━━━━\n` +
            `${emoji} ประเภท: ${label}\n` +
            `💵 จำนวนเงิน: ฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}\n` +
            `🏦 บัญชี: ${account}\n` +
            `🏷️ หมวดหมู่: ${category}\n` +
            `📅 วันที่: ${dateStr} ${timeStr}`,
        }],
      });
      return;
    }
  }

  // 3. Simple manual chat entry (e.g. "กินข้าว 60", "ค่าน้ำมัน 500", "รายรับ 20000")
  const simpleMatch = trimmed.match(/^([^\d]+?)\s*([\d,]+(?:\.\d+)?)\s*(?:บาท)?$/);
  if (simpleMatch) {
    const itemDesc = simpleMatch[1].trim();
    const amount = parseFloat(simpleMatch[2].replace(/,/g, ''));

    if (amount > 0) {
      let type: TransactionType = 'EXPENSE';
      if (/รายรับ|เงินเดือน|ได้เงิน|รับเงิน/i.test(itemDesc)) {
        type = 'INCOME';
      }

      let category = 'อื่นๆ';
      if (type === 'INCOME') category = 'เงินเดือน/รายรับ';
      else if (/ข้าว|อาหาร|กาแฟ|น้ำ|กะเพรา|กิน/i.test(itemDesc)) category = 'อาหารและเครื่องดื่ม';
      else if (/น้ำมัน|ทางด่วน|รถ|เดินทาง/i.test(itemDesc)) category = 'การเดินทาง/ค่าน้ำมัน';
      else if (/เซเว่น|7-eleven|ของใช้|ซื้อของ/i.test(itemDesc)) category = 'ของใช้ในบ้าน/ซูเปอร์';
      else if (/เสื้อ|รองเท้า|shopee|lazada|ช้อป/i.test(itemDesc)) category = 'ช้อปปิ้ง';

      const dateStr = getBangkokDateString();
      const timeStr = getBangkokTimeString();
      const txId = `line_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      const newTx: Transaction = {
        id: txId,
        date: dateStr,
        time: timeStr,
        type,
        amount,
        category,
        account: 'เงินสด',
        note: `พิมพ์ผ่าน LINE: ${itemDesc}`,
        source: 'MANUAL',
        createdAt: new Date().toISOString(),
      };

      await ensureSheetStructure();
      await appendTransactionRow(newTx);

      const emoji = type === 'INCOME' ? '🟢' : '🔴';
      await client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `✅ บันทึกรายการสำเร็จ!\n` +
            `━━━━━━━━━━━━━━━\n` +
            `${emoji} รายละเอียด: ${itemDesc}\n` +
            `💵 จำนวนเงิน: ฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}\n` +
            `🏷️ หมวดหมู่: ${category}\n` +
            `📅 วันที่: ${dateStr}`,
        }],
      });
      return;
    }
  }

  // Help command / fallback
  await client.replyMessage({
    replyToken,
    messages: [{
      type: 'text',
      text: `🤖 สวัสดีครับ! ผมคือบอทนับตังค์\n\n` +
        `คุณสามารถ:\n` +
        `1. ส่งต่อ (Forward) ข้อความแจ้งเตือนจาก KBank Live เข้ามาได้เลย\n` +
        `2. ส่งรูปสลิป เข้ามาเพื่อให้ AI อ่านยอดเงินอัตโนมัติ\n` +
        `3. พิมพ์บันทึกง่ายๆ เช่น "กินข้าว 60" หรือ "ค่าน้ำมัน 500"\n` +
        `4. พิมพ์ "สรุป" เพื่อดูยอดเงินคงเหลือล่าสุด`,
    }],
  });
}

/**
 * Process incoming slip photos from LINE chat
 */
async function handleImageMessage(replyToken: string, messageId: string) {
  const client = getLineClient();
  const blobClient = getLineBlobClient();

  try {
    // Download image stream from LINE
    const stream = await blobClient.getMessageContent(messageId);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const imageBuffer = Buffer.concat(chunks);
    const base64 = imageBuffer.toString('base64');

    // OCR with Gemini Flash-Lite
    const slipData = await analyzeSlipImage(base64, 'image/jpeg', 'LINE_UPLOAD');

    const now = new Date();
    const txId = `line_slip_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const newTx: Transaction = {
      id: txId,
      date: slipData.date,
      time: slipData.time,
      type: slipData.type,
      amount: slipData.amount,
      category: slipData.category,
      account: 'K PLUS',
      note: `สลิปผ่าน LINE: ${slipData.note}`,
      source: 'AUTO_SYNC',
      createdAt: now.toISOString(),
    };

    await ensureSheetStructure();
    await appendTransactionRow(newTx);

    const emoji = slipData.type === 'INCOME' ? '🟢' : slipData.type === 'TRANSFER' ? '🔄' : '🔴';
    const label = slipData.type === 'INCOME' ? 'รายรับ' : slipData.type === 'TRANSFER' ? 'โอนย้ายเงิน' : 'รายจ่าย';

    await client.replyMessage({
      replyToken,
      messages: [{
        type: 'text',
        text: `📸 AI อ่านรูปสลิปและบันทึกสำเร็จ!\n` +
          `━━━━━━━━━━━━━━━\n` +
          `${emoji} ประเภท: ${label}\n` +
          `💵 ยอดเงิน: ฿${slipData.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}\n` +
          `🏷️ หมวดหมู่: ${slipData.category}\n` +
          `📝 รายละเอียด: ${slipData.note}\n` +
          `📅 วันที่: ${slipData.date} ${slipData.time}`,
      }],
    });
  } catch (err: any) {
    console.error('Error handling LINE image:', err);
    await client.replyMessage({
      replyToken,
      messages: [{
        type: 'text',
        text: `❌ ไม่สามารถอ่านรูปสลิปได้: ${err.message || 'เกิดข้อผิดพลาด'}`,
      }],
    });
  }
}

import { NextResponse } from 'next/server';
import { appendTransactionRow } from '@/lib/db/transactions';
import { checkRecentTransferDuplicate, recordTransferSlip } from '@/lib/db';
import { Transaction, TransactionType } from '@/types';
import { parseNotificationText } from '@/lib/line/notification-text';
import { hasValidSecret } from '@/lib/auth/secret';

export async function POST(req: Request) {
  if (!hasValidSecret(req, process.env.WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rawBody = await req.text();
    let payload: any = {};

    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = { text: rawBody };
    }

    const messageText = payload.text || payload.message || payload.notification || rawBody;
    if (!messageText || typeof messageText !== 'string' || messageText.trim().length === 0) {
      return NextResponse.json({ error: 'Empty message text' }, { status: 400 });
    }

    const text = messageText.trim();

    // 1. Extract Amount, the accounts mentioned and the time the bank printed
    const { amount, hasKplus, hasMake, date: dateStr, time: timeStr } = parseNotificationText(text);

    if (amount === 0) {
      return NextResponse.json({
        skipped: true,
        message: 'Could not extract a valid amount from notification',
        text,
      });
    }

    // 2. Identify Account (K PLUS vs Make by KBank)
    let account = 'K PLUS';
    if (hasMake && !hasKplus) {
      account = 'Make by KBank';
    } else if (hasKplus) {
      account = 'K PLUS';
    }

    // 3. Self-Transfer Detection (โอนเงินระหว่าง 2 บัญชีนี้ หรือโอนเข้าเป๋าตังตัวเอง)
    const ownNamesConfig = process.env.OWN_ACCOUNT_NAMES || '';
    const ownNames = ownNamesConfig.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    // Self-transfer happens when:
    // a) Both registered accounts (K PLUS and Make) are involved
    // b) Or recipient explicitly mentions user's own name/account or Paotang G-Wallet
    const isBothAccounts = hasKplus && hasMake;
    const isSelfReceiver = ownNames.some(name => {
      const rx = new RegExp(`(?:ไปยัง|โอนให้|เข้าบัญชี|เข้ากระเป๋า|to)\\s*[^\\n]*?${name}`, 'i');
      return rx.test(text);
    }) || /โอนเข้าเป๋าตัง|g-wallet/i.test(text);

    const isSelfTransfer = isBothAccounts || isSelfReceiver;

    // Determine Transaction Type
    let type: TransactionType = 'EXPENSE';
    const isIncomeText = /เงินเข้า|รับโอน|ฝากเงิน|credit|deposit/i.test(text);
    const isExpenseText = /เงินออก|โอนเงิน|ชำระ|จ่าย|debit|withdraw/i.test(text);

    if (isSelfTransfer) {
      type = 'TRANSFER';
    } else if (isIncomeText) {
      type = 'INCOME';
    } else if (isExpenseText) {
      type = 'EXPENSE';
    }

    // 4. Deduplicate Transfers (KBank Live sends 2 notifications for 1 transfer: 1 out from KBank and 1 in to Make)
    if (type === 'TRANSFER') {
      const isDuplicate = await checkRecentTransferDuplicate(amount, 3);
      if (isDuplicate) {
        return NextResponse.json({
          success: true,
          message: `รายการโอนย้ายเงิน ฿${amount} ถูกบันทึกไปแล้วจากแจ้งเตือนแรก (ข้ามการบันทึกซ้ำอัตโนมัติ)`,
          skippedDuplicate: true,
        });
      }
    }

    // 5. Categorize
    let category = 'อื่นๆ';
    if (type === 'TRANSFER') {
      category = 'โอนระหว่างบัญชี';
    } else if (type === 'INCOME') {
      category = 'เงินเดือน/รายรับ';
    } else {
      const lower = text.toLowerCase();
      if (/shopee|lazada|tiktok|edc/i.test(lower)) category = 'ช้อปปิ้ง';
      else if (/ปตท|ptt|บางจาก|shell|น้ำมัน|ทางด่วน/i.test(lower)) category = 'การเดินทาง/ค่าน้ำมัน';
      else if (/เซเว่น|7-eleven|lotus|big c|cj/i.test(lower)) category = 'ของใช้ในบ้าน/ซูเปอร์';
      else if (/ไฟฟ้า|ประปา|ais|true|dtac|เน็ต/i.test(lower)) category = 'สาธารณูปโภค (น้ำ/ไฟ/เน็ต)';
      else if (/อาหาร|กาแฟ|cafe|amazon|กะเพรา/i.test(lower)) category = 'อาหารและเครื่องดื่ม';
    }

    const txId = `noti_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const newTx: Transaction = {
      id: txId,
      date: dateStr,
      time: timeStr,
      type,
      amount,
      category,
      account,
      note: `LINE แจ้งเตือน: ${text.substring(0, 80)}`,
      source: 'AUTO_SYNC',
      createdAt: new Date().toISOString(),
    };

    await appendTransactionRow(newTx);

    // Record in DB cache for deduplication
    if (type === 'TRANSFER') {
      await recordTransferSlip(txId, account, amount, dateStr);
    }

    return NextResponse.json({
      success: true,
      message: `บันทึกรายการสำเร็จ: ${type === 'INCOME' ? '🟢 รายรับ' : type === 'TRANSFER' ? '🔄 โอนย้าย' : '🔴 รายจ่าย'} ฿${amount} (${account})`,
      transaction: newTx,
    });
  } catch (error: any) {
    console.error('Notification Webhook Error:', error);
    return NextResponse.json(
      { error: error.message || 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

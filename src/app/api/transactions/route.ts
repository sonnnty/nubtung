import { NextResponse } from 'next/server';
import { getAllTransactions, appendTransactionRow, deleteTransactionRow, updateTransactionNote, updateManualTransaction, ensureSheetStructure, normalizeDateString, normalizeTimeString } from '@/lib/google/sheets';
import { Transaction, DashboardSummary } from '@/types';

export async function GET() {
  try {
    const transactions = await getAllTransactions();

    let totalIncome = 0;
    let totalExpense = 0;
    let transferTotal = 0;
    const accountBreakdown: Record<string, number> = {};
    const categoryBreakdown: Record<string, number> = {};

    for (const tx of transactions) {
      if (tx.type === 'INCOME') {
        totalIncome += tx.amount;
      } else if (tx.type === 'EXPENSE') {
        totalExpense += tx.amount;
        // Group expenses by category
        categoryBreakdown[tx.category] = (categoryBreakdown[tx.category] || 0) + tx.amount;
        // Group expenses by account
        accountBreakdown[tx.account] = (accountBreakdown[tx.account] || 0) + tx.amount;
      } else if (tx.type === 'TRANSFER') {
        transferTotal += tx.amount;
      }
    }

    // Verified baseline balances as of 2026-09-04
    const dynamicAccountBalances: Record<string, number> = {
      'K PLUS': 43253.07,
      'Make by KBank': 3672.29,
      'เป๋าตัง': 195.44,
      'เงินสด': 0.00,
    };

    // Calculate real-time dynamic balance updates from transactions dated >= 2026-09-04
    for (const tx of transactions) {
      if (tx.date >= '2026-09-04') {
        const acc = tx.account || 'เงินสด';
        if (dynamicAccountBalances[acc] === undefined) {
          dynamicAccountBalances[acc] = 0;
        }

        if (tx.type === 'INCOME') {
          dynamicAccountBalances[acc] += tx.amount;
        } else if (tx.type === 'EXPENSE') {
          dynamicAccountBalances[acc] -= tx.amount;
        } else if (tx.type === 'TRANSFER') {
          // Deduct from sender account
          const fromAcc = tx.account || 'เงินสด';
          dynamicAccountBalances[fromAcc] = (dynamicAccountBalances[fromAcc] || 0) - tx.amount;

          // Credit to destination account
          const note = (tx.note || '').toLowerCase();
          const paotangAccountNo = (process.env.PAOTANG_ACCOUNT_NO || '9289').toLowerCase();

          let toAcc: string | null = null;
          if (note.includes('ไปยัง k plus') || note.includes('เข้า k plus') || note.includes('to k plus') || note.includes('ฝากเงินเข้า k plus')) {
            toAcc = 'K PLUS';
          } else if (note.includes('ไปยัง make') || note.includes('เข้า make') || note.includes('to make') || note.includes('ฝากเงินเข้า make')) {
            toAcc = 'Make by KBank';
          } else if (note.includes('ไปยัง เป๋าตัง') || note.includes('เข้า เป๋าตัง') || note.includes('to paotang') || note.includes('เติมเงิน g-wallet')) {
            toAcc = 'เป๋าตัง';
          } else if (note.includes('ไปยัง เงินสด') || note.includes('เข้า เงินสด') || note.includes('ถอนเงินสด') || note.includes('to cash') || note.includes('ถอน atm')) {
            toAcc = 'เงินสด';
          } else if (
            note.includes(paotangAccountNo) ||
            note.includes('เป๋าตัง') ||
            note.includes('g-wallet') ||
            note.includes('ktb g-wallet')
          ) {
            toAcc = 'เป๋าตัง';
          } else if (note.includes('2996') || note.includes('make by kbank') || note.includes('make')) {
            toAcc = 'Make by KBank';
          } else if (note.includes('k plus') || (!!process.env.KPLUS_ACCOUNT_NO && note.includes(process.env.KPLUS_ACCOUNT_NO)) || note.includes('กสิกร')) {
            toAcc = 'K PLUS';
          } else if (note.includes('เงินสด') && fromAcc !== 'เงินสด') {
            toAcc = 'เงินสด';
          }

          if (toAcc) {
            dynamicAccountBalances[toAcc] = (dynamicAccountBalances[toAcc] || 0) + tx.amount;
          }
        }
      }
    }

    const totalCashInAccounts = Object.values(dynamicAccountBalances).reduce((sum, b) => sum + b, 0);

    const summary: DashboardSummary = {
      totalIncome,
      totalExpense,
      netBalance: totalIncome - totalExpense,
      transferTotal,
      accountBreakdown,
      categoryBreakdown,
      recentTransactions: transactions.slice(0, 10),
      accountBalances: dynamicAccountBalances,
      totalCashInAccounts,
    };

    return NextResponse.json({
      transactions,
      summary,
    });
  } catch (error: any) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch transactions from Google Sheets' },
      { status: 500 }
    );
  }
}

import { getBangkokDateString, getBangkokTimeString } from '@/lib/utils/date';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body.amount || !body.type || !body.category) {
      return NextResponse.json(
        { error: 'กรุณากรอกข้อมูลให้ครบถ้วน (จำนวนเงิน, ประเภท, หมวดหมู่)' },
        { status: 400 }
      );
    }

    const dateStr = normalizeDateString(body.date || getBangkokDateString());
    const timeStr = normalizeTimeString(body.time || getBangkokTimeString());

    const tx: Transaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      date: dateStr,
      time: timeStr,
      type: body.type,
      amount: parseFloat(body.amount),
      category: body.category,
      account: body.account || 'เงินสด',
      note: body.note || '',
      slipUrl: body.slipUrl || undefined,
      driveFileId: body.driveFileId || undefined,
      source: 'MANUAL',
      createdAt: new Date().toISOString(),
    };

    await appendTransactionRow(tx);

    return NextResponse.json({ success: true, transaction: tx });
  } catch (error: any) {
    console.error('Error creating transaction:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to record transaction' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'กรุณาระบุรหัสรายการ (ID) ที่ต้องการลบ' }, { status: 400 });
    }

    const result = await deleteTransactionRow(id, true);
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'ไม่สามารถลบรายการนี้ได้' }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'ลบรายการสำเร็จ' });
  } catch (error: any) {
    console.error('Error deleting transaction:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete transaction' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, type, amount, category, account, note, date, time } = body;

    if (!id) {
      return NextResponse.json({ error: 'กรุณาระบุรหัสรายการ (ID)' }, { status: 400 });
    }

    // If full transaction fields are provided, update the manual transaction
    if (amount !== undefined || type !== undefined || category !== undefined || account !== undefined || date !== undefined) {
      const result = await updateManualTransaction({
        id,
        type,
        amount: amount !== undefined ? parseFloat(amount) : undefined,
        category,
        account,
        note,
        date: date !== undefined ? normalizeDateString(date) : undefined,
        time: time !== undefined ? normalizeTimeString(time) : undefined,
      });

      if (!result.success) {
        return NextResponse.json({ error: result.error || 'ไม่สามารถแก้ไขรายการนี้ได้' }, { status: 400 });
      }

      return NextResponse.json({ success: true, message: 'แก้ไขรายการสำเร็จ' });
    }

    // Otherwise, update just the note / comment
    if (typeof note !== 'string') {
      return NextResponse.json({ error: 'กรุณาระบุข้อความที่ต้องการบันทึก' }, { status: 400 });
    }

    const updated = await updateTransactionNote(id, note);
    if (!updated) {
      return NextResponse.json({ error: 'ไม่พบรายการที่ต้องการแก้ไขใน Google Sheets' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'บันทึกรายละเอียดเพิ่มเติมสำเร็จ' });
  } catch (error: any) {
    console.error('Error updating transaction:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update transaction' },
      { status: 500 }
    );
  }
}

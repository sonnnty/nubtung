import { NextResponse } from 'next/server';
import { deduplicateTransactions } from '@/lib/db/transactions';

export async function POST() {
  try {
    const result = await deduplicateTransactions();

    return NextResponse.json({
      success: true,
      message: `ลบรายการซ้ำเรียบร้อยแล้ว: ลบออก ${result.removedCount} รายการ (จากทั้งหมด ${result.beforeCount} เหลือ ${result.afterCount} รายการ)`,
      ...result,
    });
  } catch (error: any) {
    console.error('Error deduplicating transactions:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to deduplicate transactions' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getTransactions, getTaxProfile, saveTaxProfile } from '@/lib/db/transactions';
import { calculateTax, defaultDeductions, defaultIncome } from '@/lib/tax/tax-engine';
import { categorizeTransactionsForTax } from '@/lib/tax/category-mapping';
import { withoutBalanceAdjustments } from '@/lib/balance/balance-adjustment';
import { TaxDeductions, IncomeBySection } from '@/lib/tax/tax-types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get('year');
    const parsedYear = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
    const year = isNaN(parsedYear) ? new Date().getFullYear() : parsedYear;

    // 1. Fetch saved profile if available
    const savedProfile = await getTaxProfile(year);

    const userExcludedIds: string[] = savedProfile?.excludedTransactionIds || [];

    // 2. Fetch transactions for the year
    const transactions = await getTransactions();
    const yearTransactions = withoutBalanceAdjustments(transactions).filter((tx) => {
      if (!tx.date) return false;
      return tx.date.startsWith(String(year));
    });

    const {
      syncedIncome,
      transactionsBySection,
      exemptTransactions,
    } = categorizeTransactionsForTax(yearTransactions, userExcludedIds);

    const initialIncome: IncomeBySection = savedProfile?.income || syncedIncome || defaultIncome;
    const initialDeductions: TaxDeductions = savedProfile?.deductions || {
      ...defaultDeductions,
      socialSecurity: (syncedIncome.section40_1 || 0) >= 15000 ? 9000 : 0,
    };
    const initialWithholding = savedProfile?.withholdingTax || 0;

    const calculated = calculateTax(initialIncome, initialDeductions, initialWithholding);

    return NextResponse.json({
      success: true,
      year,
      syncedIncome,
      savedProfile,
      calculated,
      transactionsBySection,
      exemptTransactions,
      userExcludedIds,
      rawYearTransactions: yearTransactions,
    });
  } catch (error: any) {
    console.error('Error fetching tax data:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch tax data' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { year, income, deductions, withholdingTax, excludedTransactionIds } = body;

    if (!year || !income || !deductions) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: year, income, deductions' },
        { status: 400 }
      );
    }

    const calculated = calculateTax(income, deductions, Number(withholdingTax) || 0);

    const parsedExcludedIds: string[] | undefined = Array.isArray(excludedTransactionIds)
      ? excludedTransactionIds.map(String)
      : undefined;

    await saveTaxProfile(calculated, deductions, Number(year), parsedExcludedIds);

    return NextResponse.json({
      success: true,
      message: 'บันทึกข้อมูลภาษีเรียบร้อยแล้ว',
      calculated,
      excludedTransactionIds: parsedExcludedIds || [],
    });
  } catch (error: any) {
    console.error('Error saving tax profile:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to save tax profile' },
      { status: 500 }
    );
  }
}


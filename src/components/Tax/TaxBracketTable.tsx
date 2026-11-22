'use client';

import React from 'react';
import { Table, Lightbulb, Scale, CheckCircle2, ArrowRight } from 'lucide-react';
import type { TaxCalculationResult } from '@/lib/tax/tax-types';
import { Badge, Card } from '@/components/ui';

interface TaxBracketTableProps {
  result: TaxCalculationResult;
}

const MAX_TAX_BY_TIER: Record<string, string> = {
  '0 - 150,000': 'ยกเว้นภาษี (฿0)',
  '150,001 - 300,000': '฿7,500',
  '300,001 - 500,000': '฿20,000',
  '500,001 - 750,000': '฿37,500',
  '750,001 - 1,000,000': '฿50,000',
  '1,000,001 - 2,000,000': '฿250,000',
  '2,000,001 - 5,000,000': '฿900,000',
  'มากกว่า 5,000,000': 'ไม่จำกัด',
};

const formatMoney = (amount: number) =>
  amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TaxBracketTable({ result }: TaxBracketTableProps) {
  const currentTier = result.taxBrackets.find((b) => b.isCurrentTier) || result.taxBrackets[0];
  const marginalRate = currentTier ? currentTier.rate : 0;
  const marginalRatePercent = (marginalRate * 100).toFixed(0);
  const savingsPer10k = 10000 * marginalRate;
  const savingsPer50k = 50000 * marginalRate;

  return (
    <Card className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
        <div>
          <h2 className="text-base font-semibold text-ink tracking-tight flex items-center gap-2">
            <Table className="w-4 h-4 text-accent-text shrink-0" />
            <span>ตารางอัตราภาษีเงินได้บุคคลธรรมดา 8 ขั้นบันได</span>
          </h2>
          <p className="text-xs text-ink-muted mt-1">
            คำนวณภาษีตามมาตรา 48(1) แห่งประมวลรัษฎากร โดยคิดแบบอัตราก้าวหน้าตามระดับเงินได้สุทธิ
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="text-xs text-ink-muted font-medium">ฐานภาษีปัจจุบัน</span>
          <Badge variant="accent" className="text-xs font-semibold tabular-nums py-1 px-2.5">
            {marginalRatePercent}% (ขั้น {currentTier.tierName})
          </Badge>
        </div>
      </div>

      {/* Progressive Tax Table */}
      <div className="overflow-x-auto rounded-control border border-border">
        <table className="w-full text-left text-xs sm:text-sm border-collapse">
          <thead className="bg-surface-subtle text-ink-secondary font-medium text-xs border-b border-border">
            <tr>
              <th className="py-3 px-3 sm:px-4 whitespace-nowrap">ช่วงเงินได้สุทธิ</th>
              <th className="py-3 px-3 sm:px-4 text-center whitespace-nowrap">อัตราภาษี</th>
              <th className="py-3 px-3 sm:px-4 text-right hidden md:table-cell whitespace-nowrap">
                ภาษีสูงสุดในขั้น
              </th>
              <th className="py-3 px-3 sm:px-4 text-right whitespace-nowrap">เงินได้ในขั้นนี้</th>
              <th className="py-3 px-3 sm:px-4 text-right whitespace-nowrap">ภาษีขั้นนี้</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {result.taxBrackets.map((bracket, index) => {
              const isCurrent = bracket.isCurrentTier;
              const hasTaxable = bracket.taxableInTier > 0;

              return (
                <tr
                  key={index}
                  className={
                    isCurrent
                      ? 'bg-accent-soft/60 text-ink font-semibold'
                      : hasTaxable
                      ? 'bg-surface text-ink'
                      : 'bg-surface-subtle/30 text-ink-muted'
                  }
                >
                  <td className="py-3 px-3 sm:px-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span>{bracket.tierName}</span>
                      {isCurrent && (
                        <Badge variant="accent">
                          <CheckCircle2 className="w-3 h-3" />
                          ขั้นปัจจุบัน
                        </Badge>
                      )}
                    </div>
                  </td>

                  <td className="py-3 px-3 sm:px-4 text-center whitespace-nowrap">
                    <Badge variant={isCurrent ? 'accent' : 'neutral'}>
                      {(bracket.rate * 100).toFixed(0)}%
                    </Badge>
                  </td>

                  <td className="py-3 px-3 sm:px-4 text-right hidden md:table-cell text-ink-muted whitespace-nowrap">
                    {MAX_TAX_BY_TIER[bracket.tierName] || '—'}
                  </td>

                  <td className="py-3 px-3 sm:px-4 text-right font-medium whitespace-nowrap">
                    ฿{formatMoney(bracket.taxableInTier)}
                  </td>

                  <td className="py-3 px-3 sm:px-4 text-right font-semibold whitespace-nowrap">
                    ฿{formatMoney(bracket.taxInTier)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-surface-subtle font-semibold border-t border-border tabular-nums">
            <tr>
              <td colSpan={3} className="py-3 px-3 sm:px-4 text-ink hidden md:table-cell">
                รวมภาษีคำนวณแบบขั้นบันได (วิธีที่ 1)
              </td>
              <td colSpan={2} className="py-3 px-3 sm:px-4 text-ink md:hidden">
                รวมภาษีขั้นบันได (วิธี 1)
              </td>
              <td className="py-3 px-3 sm:px-4 text-right text-ink" colSpan={2}>
                ฿{formatMoney(result.progressiveTax)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Method Comparison Callout */}
      <div className="p-4 sm:p-5 rounded-control bg-surface-subtle/50 border border-border space-y-3.5">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-accent-text shrink-0" />
          <h3 className="text-xs sm:text-sm font-semibold text-ink">
            การเปรียบเทียบวิธีคำนวณภาษี (วิธีที่ 1 กับ วิธีที่ 2)
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Method 1 */}
          <div
            className={`p-4 rounded-control border ${
              result.taxMethodUsed === 'progressive'
                ? 'bg-surface border-accent-border'
                : 'bg-surface/60 border-border'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs font-semibold text-ink">วิธีที่ 1: อัตราภาษีก้าวหน้า</span>
              {result.taxMethodUsed === 'progressive' && (
                <Badge variant="accent">วิธีที่ถูกเลือก</Badge>
              )}
            </div>
            <p className="text-xs text-ink-muted mb-2">
              คำนวณจากเงินได้สุทธิ (เงินได้พึงประเมิน - ค่าใช้จ่าย - ค่าลดหย่อน)
            </p>
            <span className="text-lg font-bold text-ink tabular-nums">
              ฿{formatMoney(result.progressiveTax)}
            </span>
          </div>

          {/* Method 2 */}
          <div
            className={`p-4 rounded-control border ${
              result.taxMethodUsed === 'flat05'
                ? 'bg-surface border-expense-border'
                : 'bg-surface/60 border-border'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs font-semibold text-ink">วิธีที่ 2: เหมาจ่ายร้อยละ 0.5</span>
              {result.taxMethodUsed === 'flat05' && (
                <Badge variant="expense">วิธีที่ถูกเลือก</Badge>
              )}
            </div>
            <p className="text-xs text-ink-muted mb-2">
              คำนวณจากเงินได้อื่นที่ไม่ใช่ 40(1) รวมกันตั้งแต่ 120,000 บ. ขึ้นไป (0.5%)
            </p>
            <span className="text-lg font-bold text-ink tabular-nums">
              ฿{formatMoney(result.flatTax05)}
            </span>
          </div>
        </div>

        {/* Legal Rationale Note */}
        <div className="text-xs text-ink-secondary bg-surface p-3.5 rounded-control border border-border leading-relaxed">
          <span className="font-semibold text-ink">สรุปหลักเกณฑ์การประเมิน: </span>
          {result.taxMethodUsed === 'flat05' ? (
            <span>
              คุณมีเงินได้ประเภทอื่นนอกจากเงินเดือน 40(1) รวมกัน ฿
              {result.nonSalaryIncome.toLocaleString('th-TH')} ซึ่งเกิน 120,000 บาท และยอดภาษีเหมา 0.5% (฿
              {result.flatTax05.toLocaleString('th-TH')}) มีจำนวนสูงกว่าภาษีวิธีที่ 1 ตามประมวลรัษฎากร ม.48(2) กำหนดให้เสียตามจำนวนที่มากกว่า
            </span>
          ) : result.nonSalaryIncome < 120000 ? (
            <span>
              เงินได้อื่นนอกจากเงินเดือน 40(1) รวมกัน ฿
              {result.nonSalaryIncome.toLocaleString('th-TH')} ซึ่งไม่ถึงเกณฑ์ 120,000 บาท จึงได้รับการยกเว้นไม่ต้องคำนวณภาษีวิธีเหมา 0.5%
            </span>
          ) : !result.flatTax05Applicable ? (
            <span>
              เงินได้อื่นนอกจากเงินเดือนเกิน 120,000 บาท แต่ภาษีคำนวณร้อยละ 0.5 ไม่เกิน 5,000 บาท กฎหมายจึงยกเว้นไม่ต้องเสียตามวิธีเหมา ให้เสียตามวิธีอัตราก้าวหน้า
            </span>
          ) : (
            <span>
              ภาษีตามวิธีอัตราก้าวหน้า (฿{result.progressiveTax.toLocaleString('th-TH')}) สูงกว่าภาษีเหมา 0.5% (฿
              {result.flatTax05.toLocaleString('th-TH')}) กฎหมายกำหนดให้เสียตามจำนวนภาษีที่คำนวณได้สูงกว่า
            </span>
          )}
        </div>
      </div>

      {/* Tax Optimization Tip Card */}
      <div className="p-4 sm:p-5 rounded-control bg-accent-soft/50 border border-accent-border space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-control bg-surface border border-accent-border text-accent-text flex items-center justify-center shrink-0">
            <Lightbulb className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-semibold text-ink">
              คำแนะนำการวางแผนภาษี
            </h3>
            <span className="text-xs text-ink-muted">
              วิเคราะห์จากฐานภาษีส่วนเพิ่ม (Marginal Tax Bracket) ปัจจุบันของคุณ
            </span>
          </div>
        </div>

        {marginalRate === 0 ? (
          <div className="text-xs text-ink-secondary bg-surface p-3.5 rounded-control border border-border leading-relaxed">
            <strong className="text-ink">ปัจจุบันเงินได้สุทธิของคุณอยู่ในเกณฑ์ยกเว้นภาษี (0%)</strong>{' '}
            คุณยังไม่ต้องชำระภาษีเงินได้บุคคลธรรมดา จึงยังไม่มีความจำเป็นต้องซื้อกองทุนลดหย่อนภาษีเพิ่มเติมเพื่อประหยัดภาษีในปีนี้
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="text-xs text-ink-secondary leading-relaxed">
              ฐานภาษีส่วนเพิ่มของคุณอยู่ที่ <strong className="text-ink">{marginalRatePercent}%</strong>{' '}
              ทุกการลดหย่อนภาษีที่เพิ่มขึ้น 1 บาท จะช่วยประหยัดภาษีได้{' '}
              <strong className="text-ink">{marginalRate} บาท</strong>
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <div className="p-3 bg-surface rounded-control border border-border flex items-center justify-between gap-2 tabular-nums">
                <div className="flex items-center gap-2 text-xs text-ink-secondary">
                  <ArrowRight className="w-3.5 h-3.5 text-accent-text shrink-0" />
                  <span>ซื้อ ThaiESG / RMF เพิ่ม ฿10,000</span>
                </div>
                <span className="text-xs font-semibold text-income shrink-0">
                  ประหยัด ฿{savingsPer10k.toLocaleString('th-TH')}
                </span>
              </div>

              <div className="p-3 bg-surface rounded-control border border-border flex items-center justify-between gap-2 tabular-nums">
                <div className="flex items-center gap-2 text-xs text-ink-secondary">
                  <ArrowRight className="w-3.5 h-3.5 text-accent-text shrink-0" />
                  <span>ซื้อ ThaiESG / RMF เพิ่ม ฿50,000</span>
                </div>
                <span className="text-xs font-semibold text-income shrink-0">
                  ประหยัด ฿{savingsPer50k.toLocaleString('th-TH')}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

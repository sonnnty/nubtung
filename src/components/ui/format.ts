/** Format a numeric amount consistently with Thai grouping and 2-3 decimal places (without currency symbol). */
export function formatMoney(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}

/** Format a numeric amount with the Thai Baht prefix (e.g. ฿1,250.00). */
export function formatBaht(amount: number): string {
  return `฿${formatMoney(amount)}`;
}

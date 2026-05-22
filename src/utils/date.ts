/**
 * Utility functions for timezone-aware date calculations.
 */

/**
 * Calculates the active filing Financial Year (FY) and Assessment Year (AY)
 * based on the current date in the India Standard Time (IST) timezone.
 * 
 * During an ongoing financial year, tax returns are filed for the PREVIOUS completed financial year.
 * Examples:
 * - 19 May 2026 -> FY 2025-26, AY 2026-27
 * - 10 Jan 2026 -> FY 2024-25, AY 2025-26
 * - 2 Apr 2027 -> FY 2026-27, AY 2027-28
 * 
 * @param date The date to calculate for (defaults to current system date)
 */
export const getFinancialAndAssessmentYear = (date: Date = new Date()): { fy: string; ay: string } => {
  // Extract date components in the Asia/Kolkata (IST) timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });
  
  const formattedParts = formatter.formatToParts(date);
  const parts = formattedParts.reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {} as Record<string, string>);

  const year = parseInt(parts.year, 10);
  const month = parseInt(parts.month, 10); // 1-12 range
  
  // Filing FY is the PREVIOUS completed financial year.
  // April to December -> starts in year - 1
  // January to March -> starts in year - 2
  const fyStartYear = month >= 4 ? year - 1 : year - 2;
  const fyEndYear = fyStartYear + 1;
  
  const ayStartYear = fyStartYear + 1;
  const ayEndYear = ayStartYear + 1;

  // Format years as YYYY-YY (e.g. 2025-26)
  const formatFY = `${fyStartYear}-${String(fyEndYear).slice(-2)}`;
  const formatAY = `${ayStartYear}-${String(ayEndYear).slice(-2)}`;

  return { fy: formatFY, ay: formatAY };
};

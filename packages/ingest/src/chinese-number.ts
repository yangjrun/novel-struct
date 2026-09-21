const DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const UNITS: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1000 };
const TEN_THOUSAND = '万';

const FULLWIDTH_ZERO = 0xff10;

/**
 * Parses chapter numbers written as ASCII digits, full-width digits or Chinese numerals.
 * Numerals with units (三百二十五) are summed positionally by unit; numerals without any unit
 * (一〇八, 二零二四) are read digit by digit. Returns undefined for anything else.
 */
export function parseChineseNumber(input: string): number | undefined {
  const s = input.trim();
  if (s.length === 0) return undefined;
  const ascii = toAsciiDigits(s);
  if (/^\d+$/.test(ascii)) return Number.parseInt(ascii, 10);
  return parseNumerals([...s]);
}

function toAsciiDigits(s: string): string {
  return Array.from(s, (ch) => {
    const code = ch.charCodeAt(0);
    return code >= FULLWIDTH_ZERO && code <= FULLWIDTH_ZERO + 9 ? String(code - FULLWIDTH_ZERO) : ch;
  }).join('');
}

function parseNumerals(chars: readonly string[]): number | undefined {
  if (!chars.every((ch) => ch in DIGITS || ch in UNITS || ch === TEN_THOUSAND)) return undefined;
  const hasUnit = chars.some((ch) => ch in UNITS || ch === TEN_THOUSAND);
  return hasUnit ? parseWithUnits(chars) : chars.reduce((acc, ch) => acc * 10 + DIGITS[ch]!, 0);
}

function parseWithUnits(chars: readonly string[]): number {
  let total = 0;
  let section = 0;
  let pending = 0;
  for (const ch of chars) {
    if (ch in DIGITS) {
      pending = DIGITS[ch]!;
    } else if (ch in UNITS) {
      const unit = UNITS[ch]!;
      section += (pending === 0 && unit === 10 ? 1 : pending) * unit;
      pending = 0;
    } else {
      total += (section + pending) * 10_000;
      section = 0;
      pending = 0;
    }
  }
  return total + section + pending;
}

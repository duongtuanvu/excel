// Compare coefficient and exponent as decimal text before passing a value to Number.
function decimalSignature(text: string): string {
  const [mantissa, exponent = '0'] = text.toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.replace(/^[+-]/, '').split('.');
  const digits = (whole + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  const significant = digits.replace(/0+$/, '');
  const power = Number(exponent) - fraction.length + digits.length - significant.length;
  return (mantissa.startsWith('-') ? '-' : '') + significant + 'e' + power;
}

/** Keep a numeric string when the Number round trip would alter the stored amount. */
export function losslessNumericCell(text: string): number | string {
  const value = text.trim();
  const n = Number(value);
  if (!Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n))) return value;
  const signature = decimalSignature(value);
  // Excel numeric cells retain at most 15 significant decimal digits on export.
  if (signature.split('e')[0].replace('-', '').length > 15) return value;
  return signature === decimalSignature(String(n)) ? n : value;
}

import data from '../src/shared/data/reservedNames.json';

/** Look-alike character substitutions (adm1n -> admin, etc.). Digits are mapped back to letters before comparing */
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** Normalize for comparison (full-width -> half-width, lower case, strip separators, undo substitutions) */
export function normalizeName(s: string): string {
  return [
    ...s
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s_\-.・･]/g, ''),
  ]
    .map((c) => LEET[c] ?? c)
    .join('');
}

const contains = (data.contains as string[]).map(normalizeName);
const exact = new Set((data.exact as string[]).map(normalizeName));

/** Whether a name could be mistaken for the operators or an official account (the list is in src/shared/data/reservedNames.json) */
export function isReservedName(name: string): boolean {
  const n = normalizeName(name);
  if (!n) return false;
  return exact.has(n) || contains.some((w) => n.includes(w));
}

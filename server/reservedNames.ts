import data from '../src/shared/data/reservedNames.json';

/** 見分けにくくするための文字の置き換え(adm1n → admin など)。数字は文字に戻して比べる */
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** 比べるための形にそろえる(全角→半角・小文字・区切りの除去・数字の置き換え) */
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

/** 運営・公式だと誤解される名前か(一覧は src/shared/data/reservedNames.json) */
export function isReservedName(name: string): boolean {
  const n = normalizeName(name);
  if (!n) return false;
  return exact.has(n) || contains.some((w) => n.includes(w));
}

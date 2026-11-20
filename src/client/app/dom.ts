/** DOM の小さな道具 */
export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** HTML に埋め込む文字列のエスケープ(他のプレイヤーが付けた名前などを表示するとき必ず通す) */
export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** スマホ/タブレット(タッチ主体)かどうか */
export const isTouch = window.matchMedia('(pointer: coarse)').matches;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

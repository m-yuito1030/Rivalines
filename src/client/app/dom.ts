/** Small DOM helpers */
export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Escape a string for embedding in HTML (always use it when showing names set by other players) */
export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Whether it is a phone/tablet (touch-first) */
export const isTouch = window.matchMedia('(pointer: coarse)').matches;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

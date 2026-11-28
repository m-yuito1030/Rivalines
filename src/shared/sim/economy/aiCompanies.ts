/**
 * Computer-run companies ("AI" companies). They run like players: they hold a Company, build with the same commands, and appear in the
 * company list and the rankings, so the world is not empty when few people are online. They are driven by plain rules (see server/ai.ts), not by a model.
 *
 * Their IDs are a reserved block ABOVE every account ID (the tile owner layers are 16-bit, so IDs must stay below 65536; accounts stop at AI_ID_BASE - 1).
 */
export const AI_ID_BASE = 60001;
/** The most AI companies there can be */
export const AI_MAX = 12;

/** What a company specializes in: a bus company, a railway, real estate (facilities), or a general company that does all of it in turn */
export type AiKind = 'bus' | 'rail' | 'estate' | 'general';
/** How it plays: aggressive companies expand fast, keep little cash, and borrow; cautious ones expand slowly, stay near home, and keep a cash reserve */
export type AiStyle = 'aggressive' | 'cautious';

export interface AiProfile {
  id: number;
  /** Company name (fictional) */
  name: string;
  /** Company color */
  color: number;
  kind: AiKind;
  style: AiStyle;
}

// The first four cover every kind, so even a world with 4 AI companies has a bus company, a railway, a real-estate company, and a general company
const PROFILES: Omit<AiProfile, 'id'>[] = [
  { name: 'みなと交通', color: 0x1f9d8a, kind: 'bus', style: 'aggressive' },
  { name: '北星鉄道', color: 0x4a90d9, kind: 'rail', style: 'cautious' },
  { name: '千歳不動産', color: 0xd9b43d, kind: 'estate', style: 'aggressive' },
  { name: '白鷺ホールディングス', color: 0x8e5bd9, kind: 'general', style: 'cautious' },
  { name: 'さくら急行電鉄', color: 0xd9578f, kind: 'rail', style: 'aggressive' },
  { name: 'あかつきバス', color: 0xe07b39, kind: 'bus', style: 'cautious' },
  { name: 'やまびこ地所', color: 0x7bb83d, kind: 'estate', style: 'cautious' },
  { name: '大和総合開発', color: 0xb5493d, kind: 'general', style: 'aggressive' },
  { name: '朝日鉄道', color: 0xe0a13d, kind: 'rail', style: 'aggressive' },
  { name: 'うみかぜ運輸', color: 0x3dbad9, kind: 'bus', style: 'aggressive' },
  { name: '緑風開発', color: 0x3da35a, kind: 'estate', style: 'aggressive' },
  { name: 'はるか総合', color: 0x5f6f8f, kind: 'general', style: 'cautious' },
];

export const AI_PROFILES: AiProfile[] = PROFILES.map((p, i) => ({ id: AI_ID_BASE + i, ...p }));

export const isAiId = (id: number): boolean => id >= AI_ID_BASE && id < AI_ID_BASE + AI_MAX;

export const aiProfile = (id: number): AiProfile | undefined => (isAiId(id) ? AI_PROFILES[id - AI_ID_BASE] : undefined);

/** Japanese labels for the screen (shown through tr()) */
export const AI_KIND_LABEL: Record<AiKind, string> = { bus: 'バス専門', rail: '鉄道専門', estate: '不動産・施設', general: '総合' };
export const AI_STYLE_LABEL: Record<AiStyle, string> = { aggressive: '積極的', cautious: '慎重' };

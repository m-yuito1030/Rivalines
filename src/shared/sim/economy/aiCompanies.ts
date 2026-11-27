/**
 * Computer-run companies ("AI" companies). They run like players: they hold a Company, build with the same commands, and appear in the
 * company list and the rankings, so the world is not empty when few people are online. They are driven by plain rules (see server/ai.ts), not by a model.
 *
 * Their IDs are a reserved block ABOVE every account ID (the tile owner layers are 16-bit, so IDs must stay below 65536; accounts stop at AI_ID_BASE - 1).
 */
export const AI_ID_BASE = 60001;
/** The most AI companies there can be */
export const AI_MAX = 12;

export interface AiProfile {
  id: number;
  /** Company name (fictional) */
  name: string;
  /** Company color */
  color: number;
}

const PROFILES: Omit<AiProfile, 'id'>[] = [
  { name: 'みなと交通', color: 0x1f9d8a },
  { name: 'あかつき電鉄バス', color: 0xe07b39 },
  { name: '千歳観光バス', color: 0x8e5bd9 },
  { name: 'やまびこ運輸', color: 0x4a90d9 },
  { name: 'さくら急行', color: 0xd9578f },
  { name: '北星バス', color: 0x7bb83d },
  { name: 'はるか交通', color: 0xd9b43d },
  { name: '白鷺ライン', color: 0x5f6f8f },
  { name: '大和バスサービス', color: 0xb5493d },
  { name: 'うみかぜ運輸', color: 0x3dbad9 },
  { name: '朝日バス', color: 0xe0a13d },
  { name: '緑風交通', color: 0x3da35a },
];

export const AI_PROFILES: AiProfile[] = PROFILES.map((p, i) => ({ id: AI_ID_BASE + i, ...p }));

export const isAiId = (id: number): boolean => id >= AI_ID_BASE && id < AI_ID_BASE + AI_MAX;

export const aiProfile = (id: number): AiProfile | undefined => (isAiId(id) ? AI_PROFILES[id - AI_ID_BASE] : undefined);

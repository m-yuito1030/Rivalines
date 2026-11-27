// Refreshes the display-only exchange rates (src/shared/data/currencies.json).
// Usage: node scripts/update-rates.mjs
// The game itself always runs in yen. The rates are only used to show amounts in the currency the player chose, so a fixed snapshot is
// enough (there is no live feed in the game: no outside request is made while playing). Run this now and then to refresh the snapshot.
// Source: Exchange Rate API (https://www.exchangerate-api.com), the free open endpoint. Attribution is required, and is shown in the settings.
import { writeFileSync } from 'node:fs';

// code: [symbol, decimals, Japanese name, English name]. decimals = how many decimals the currency normally shows for small amounts.
const META = {
  JPY: ['¥', 0, '日本円', 'Japanese yen'],
  USD: ['$', 2, '米ドル', 'US dollar'],
  EUR: ['€', 2, 'ユーロ', 'Euro'],
  GBP: ['£', 2, '英ポンド', 'British pound'],
  CNY: ['CN¥', 2, '中国人民元', 'Chinese yuan'],
  KRW: ['₩', 0, '韓国ウォン', 'South Korean won'],
  TWD: ['NT$', 0, '台湾ドル', 'New Taiwan dollar'],
  HKD: ['HK$', 2, '香港ドル', 'Hong Kong dollar'],
  SGD: ['S$', 2, 'シンガポールドル', 'Singapore dollar'],
  AUD: ['A$', 2, '豪ドル', 'Australian dollar'],
  CAD: ['C$', 2, 'カナダドル', 'Canadian dollar'],
  NZD: ['NZ$', 2, 'ニュージーランドドル', 'New Zealand dollar'],
  CHF: ['CHF ', 2, 'スイスフラン', 'Swiss franc'],
  INR: ['₹', 2, 'インドルピー', 'Indian rupee'],
  BRL: ['R$', 2, 'ブラジルレアル', 'Brazilian real'],
  MXN: ['MX$', 2, 'メキシコペソ', 'Mexican peso'],
  THB: ['฿', 2, 'タイバーツ', 'Thai baht'],
  VND: ['₫', 0, 'ベトナムドン', 'Vietnamese dong'],
  IDR: ['Rp ', 0, 'インドネシアルピア', 'Indonesian rupiah'],
  PHP: ['₱', 2, 'フィリピンペソ', 'Philippine peso'],
  MYR: ['RM ', 2, 'マレーシアリンギット', 'Malaysian ringgit'],
  SEK: ['kr ', 2, 'スウェーデンクローナ', 'Swedish krona'],
  NOK: ['kr ', 2, 'ノルウェークローネ', 'Norwegian krone'],
  DKK: ['kr ', 2, 'デンマーククローネ', 'Danish krone'],
  PLN: ['zł ', 2, 'ポーランドズウォティ', 'Polish zloty'],
  CZK: ['Kč ', 2, 'チェココルナ', 'Czech koruna'],
  HUF: ['Ft ', 0, 'ハンガリーフォリント', 'Hungarian forint'],
  TRY: ['₺', 2, 'トルコリラ', 'Turkish lira'],
  ZAR: ['R ', 2, '南アフリカランド', 'South African rand'],
  AED: ['AED ', 2, 'UAEディルハム', 'UAE dirham'],
  SAR: ['SAR ', 2, 'サウジリヤル', 'Saudi riyal'],
  ILS: ['₪', 2, 'イスラエルシェケル', 'Israeli shekel'],
};

const res = await fetch('https://open.er-api.com/v6/latest/JPY');
if (!res.ok) throw new Error(`rate API failed: ${res.status}`);
const j = await res.json();
if (j.result !== 'success') throw new Error('rate API did not succeed');
const currencies = {};
for (const [code, [symbol, decimals, ja, en]] of Object.entries(META)) {
  const rate = code === 'JPY' ? 1 : j.rates[code];
  if (!(rate > 0)) throw new Error(`no rate for ${code}`);
  currencies[code] = { symbol, decimals, rate: Number(rate.toPrecision(6)), name: { ja, en } };
}
const out = { base: 'JPY', updatedAt: new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10), source: 'Exchange Rate API (https://www.exchangerate-api.com)', note: 'rate = how much of the currency one yen buys (display only)', currencies };
writeFileSync(new URL('../src/shared/data/currencies.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`updated ${Object.keys(currencies).length} currencies (${out.updatedAt}) USD/JPY ≈ ${(1 / currencies.USD.rate).toFixed(2)}`);

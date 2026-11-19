# 引き継ぎ資料(シミュレーター)

最終更新: 2026-11-17 / ブランチ: `claude/exciting-johnson-gvyeow` / リポジトリ: `m-yuito1030/Simulator`(非公開)

## 1. これは何か
OpenTTD風のWebブラウザで動く交通・街づくりサンドボックス。街が自動で成長し、プレイヤーが道路・鉄道・空港を敷いて、バス・列車・飛行機で乗客を運ぶ。資金/勝敗なし。バックエンド不要の静的Webアプリ。

## 2. 決定事項(要件の経緯)
| 項目 | 決定 |
|---|---|
| 名前 | シミュレーター(仮) |
| 描画 | アイソメトリック2D + WebGL(PixiJS v8) |
| 技術 | TypeScript + Vite + PixiJS。テストは Vitest |
| マップ | 最大 4096×4096(256/512/1024/2048/4096)。スマホは512推奨 |
| モード | サンドボックスのみ |
| 輸送対象 | 乗客のみ(貨物・産業なし) |
| 時間 | 実時間30分=ゲーム内1日(x1)。x2/x4/x8/x16 |
| 道路 | 一方通行を設定/変更可能 |
| 車両 | 型式・名称・配色はすべて架空(実在のJR東日本等の名称は使わない) |
| 運行 | 間隔(停車秒/満載待ち)と時刻表(周期付き)を併用 |
| 配信 | ローカルUbuntuサーバで静的配信して仮検証。スマホ対応(PWA) |
| 素材 | OpenTTDのグラフィックは使わない。描画はすべてプロシージャル |

詳細な要件: `docs/REQUIREMENTS.md`(初期の要件。実装済みの内容は README の進捗が最新)。

## 3. 実行方法
```bash
npm install
npm run dev        # 開発(5173)
npm run build && npm run preview   # 配信(4173)
npm test           # 98件
npm run typecheck
```
サーバで一発起動: `bash scripts/deploy.sh`(Node導入→取得/更新→ビルド→バックグラウンド起動。`stop/status/logs`)。
リポジトリは非公開なので、サーバでの取得にはGitHubのトークン(Contents: Read-only)が必要。

## 4. 構成(src/)
| パス | 役割 |
|---|---|
| `main.ts` | 起動画面、ゲーム初期化、HUD、ツールバー、セーブUI配線、ラベル、性能計測 |
| `world/` | データ層。`gameMap.ts`(TypedArray群: height/road/rail/air/building/owner)、`terrain.ts`(ノイズ地形)、`terrain.worker.ts`、`roads.ts`/`rails.ts`/`airports.ts`/`terraform.ts`、`towns.ts`(街の配置と成長)、`tileRules.ts`(踏切)、`directions.ts` |
| `sim/` | シミュレーション。`simulation.ts`(tick/時計/時間予算)、`transit.ts`(停留所・路線・車両・乗客の中核)、`routing.ts`(乗り換え経路表)、`pathfinding.ts`(A*) |
| `render/` | `chunkRenderer.ts`(チャンク描画・LOD・LRU・dirty再描画)、`terrainDraw.ts`(地表・水・崖・木・ノイズ)、`drawTile.ts`(道路/線路/建物/空港)、`transitLayer.ts`(停留所/車両/列車/航空機)、`camera.ts`(パン/ズーム/マルチタッチ)、`palette.ts` |
| `ui/` | `tools.ts`(建設ツール)、`routePanel.ts`(路線パネル)、`minimap.ts`、`saveUi.ts` |
| `save/` | `serialize.ts`(gzip+独自バイナリ)、`storage.ts`(IndexedDB) |
| `data/models.ts` | 車両モデル300種(鉄道190/バス70/航空機40。元の8種は固定、残りは決定論的に生成)。鉄道は `cap`=1両の定員、`minCars/maxCars`(単行は1/1、複数両は2以上)、`defaultCars`。路線の `route.cars` で編成長を指定 |

## 5. 設計の要点(はまりやすい所)
- **タイルはTypedArray**(1バイト/層)。4096²=約1677万タイル。層を増やすとメモリが効く(現在 height16+road16+rail16+air16+building16+owner32=約112MB)。
- **座標**: タイル(x,y)→ワールド `((x-y)*32, (x+y)*16 - level*8)`。向き 0=N(-y) 1=E(+x) 2=S(+y) 3=W(-x)。
- **道路ビット**: 下位4bit=接続、上位4bit=その方向へ出られる(一方通行は片側の出口ビットだけ)。線路は接続ビットのみ(下位4bit=N,E,S,W、上位4bit=NE,SE,SW,NW の斜め。斜めは `DX8/DY8`、画面上は横・縦に見える)。
- **描画**: 1チャンク=16×16セルをCanvas2Dでテクスチャ化(解像度0.5/1/2倍をズームで切替)。地表の装飾(草・木・窓など)は座標とシードのハッシュで決まる決定論的な描画で、ゲーム状態には影響しない。昼夜は乗算オーバーレイ(窓の点灯は未対応)。ズームでLOD(1/4/16タイル/セル)切替、新LODが揃うまで旧を残す。変更タイルは `markDirty` で該当チャンクだけ再生成。
- **橋・トンネル**: `map.span`(bit4=橋/bit5=トンネル、下位4bit=路面の段数)が中間タイルを示し、道路/線路ビットは通常どおり立てる(経路探索・車両は無改修)。`world/spans.ts`。路面の高さは `map.surfaceLevel/smoothLevel`(スロープは中心→辺で1段上る)。川は `terrain.ts` の `carveRivers`(TERRAIN_VERSION=2)。
- **建物**: `map.building` は `world/buildings.ts` の形式(段階S/M/L=1〜3、種類0〜24、オフィスbit)。Lは2x2を占有し、最前面タイルがアンカー、残り3タイルは付属タイル(0x40|オフセット)。描画は `render/buildingSprites.ts` のアトラス(`src/assets/buildings.png`、128x192/セル)。スプライト未読込のときは従来の手続き描画。
- **信号・閉塞**: `Transit.signals`(タイル→方向ビット、一方向のみ)。編成は `v.resTo`(経路のうち予約済みの最後の添字)まで予約し、`nextReserveEnd`/`extendReservation` で信号ごとに前方の閉塞を確保(信号なしなら終点まで)。待ち中は `v.stuck` が増える。単線に両方向の信号を置く用途はデッドロックするため非対応。
- **分割・併合**: `v.cars`(実際の両数)/`v.hold`(待機)。`splitTrain`/`coupleTrains`/`departHeld`。併合は両端のタイルが線路でつながっている停車中の2編成のみ。UIは駅の情報パネル(`ui/infoPanel.ts`)。
- **駅・経由点**: `Stop.station`(`world/stations.ts`: 軸・長さ・番線数・デザイン・左上)と `Stop.waypoint`。駅は全タイルが `stopAt` に登録され、停車位置は番線ごとの両端(`docks`)から進行方向の奥側を選ぶ(`railCandidates`)。空いている番線を順に試す。経由点は路線のオーダーに入るが乗客・経路表(Router)からは除外され、`depart` が経由点のタイルを順に通る経路を作る。駅のデザインは0〜99(屋根5種×配色5種×駅舎4種、`world/stations.ts` の `designParts`/`designName`)。描画は `transitLayer.drawStation/drawWaypoint`。
- **オーダー拡張**: `Order.cond`(出発時の条件付きジャンプ。`Transit.condHolds`、`depart` で評価。発車案内/走行見込みは条件を考慮しない)、`Route.shared`(共有グループ。`shareRoute`/`unshareRoute`/`syncOrders`。オーダーと周期を全員へコピー)、時刻表自動作成は `autoTimetable`(UIボタンあり)。
- **車両基地**: `Transit.depots`(種類はタイルで決まる)。`buyVehicle` が `addVehicle(..., {tile})` で基地のタイルから出し、最初の停留所へ即出発。UIは `ui/infoPanel.ts` の depotHtml。路線パネルの＋車両は `nearestDepot` から購入。
- **会社の評価**: `sim/rating.ts`(1分ごとに目標点へ近づける。15点未満で `locked`=開発不可、25点以上で解除)。`ToolController.canBuild` が建設系ツールを止める。
- **人口移動**: `sim/migration.ts`(30秒ごとに街ごとに低確率で、圏外の建物1棟を圏内へ建て直し)。`Simulation.migrated` に累計。
- **オーダー編集**: `insertOrder/removeOrder/moveOrder`(共有路線にも適用、車両の order と条件の飛び先を付け替え。そのオーダーにいる車両がいると削除不可)。実測の区間は `Route.legMeasured`。
- **施設**: `world/facilities.ts`(`map.facilities` と、building レイヤーの `FACILITY_TILE`=0xFC)。停留所の `fpop/facs`(集客圏の施設)が `generate` の需要と Router の重みに加わる(時間帯係数 `hourFactor`)。描画は `transitLayer.drawFacility`。
- **描画の軽量化**: `transitLayer` は infra(駅・基地・信号・施設・人)を4Hz/視点が描画範囲を出たとき/構造変更時だけ描き直し、車両は `put()` で型・色・向きごとのテクスチャ(`texFor`)のスプライトを置く。ホームの人数は `crowdShown`(待ち人数÷6〜10、1秒に約6人ずつ増減)。負荷テストはバス1000台(headlessで車両描画 約47〜150ms→15〜20ms)。sim は1000台で約0.55ms/tick。
- **経営**: `sim/economy.ts`(`Company`: 現金・借入・今日/累計の分類別台帳・30日履歴、`PRICES`/`FARE`/`vehiclePrice`)。`Transit.onFare/onVisit` フック → `Simulation` が `company.fare/visits` に接続。1日の締め(`endOfDay`)で運行費・維持費・利払い。建設費は `ToolController`(`afford/pay`)と `main.ts` の各ハンドラで支払い、車両代は `InfoPanel`/`RoutePanel`。施設は `owner`(player/city)で売上の帰属が決まり、`facilityValue` が買収・売却額。民間施設は `sim/cityBusiness.ts`。経営画面は `ui/financePanel.ts`。
- **格付け・株価・競合・ランキング**: `Company.updateCreditAndStock`(毎日。`credit` 点→`gradeOf`、`stock`/`stockHistory`)。競合は `sim/rivals.ts`(`Simulation.rivals`、街とは別の乱数 `rivalRng`)。`acquireRival/divestRival`。民間施設は `Facility.ownerId`=競合ID。路線の `income/profit`(日次EMA)は `Simulation` の日締めで更新。ランキングは `sim/ranking.ts` と `ui/rankingPanel.ts`。画面右上のステータスは `#status`。
- **暦・決算**: `sim/calendar.ts`(2026/4/1 開始、`calendarOf/fiscalPeriodOf/quarterOf`、期首4月)。日の締めは暦の 0:00(開始から3/4日後が最初)。`Simulation` が期の最終日に `Company.closeFiscalYear`(インフラ償却10%・繰越欠損金・法人税30%・配当・`FiscalReport`)を呼び `onFiscalClose` を通知。建設費は `infra` として資産計上(`netWorth` に含む)。
- **オフィスの追加100種**: `src/assets/offices2.png`(`tools/office2-sprites/gen2.py` で生成した300枚を15列×20行に並べ、256色化)。`render/buildingSprites.ts` が旧25種+新100種の計125種から、タイルの個体差 `hv`(位置のハッシュ)で選ぶ。アトラスの作り方: sprites/office2_NNN_{S,M,L}.png を (i%5*3+S/M/L, i//5) のセルに貼り、`quantize(255, FASTOCTREE)` で保存。
- **公共施設**: `Facility.owner==='public'`(`type` は school/cityhall、`size` S/M/L、`design`、`townId`)。`sim/publicFacilities.ts` の `placePublicFacilities` が街ごとに市役所1つ・学校(人口に応じ、`SCHOOL_MIN_DISTANCE`=15 タイル)を自動配置(乱数は別系列 `pubRng`)。需要は `FacilitySpec.windows/base`(学校=8時台・17時台)と `hours:[0,24]`(市役所=一定)。描画は `render/buildingSprites.ts` の `drawFacilitySprite`(アトラス `school.png`/`cityhall.png`)をチャンク側で、敷地の手前タイル(`facilityAnchor`)に描く。撤去は `removeBuilding` が拒否。
- **百貨店・モールのスプライト**: `src/assets/department.png` / `mall.png`(各20種、15列×4行)。`Facility.design` が決まっているものだけスプライトで描く(`isSpriteFacility`)。designの無い古いセーブの施設(4×3)は手続き描画のまま。サイズは `spriteDims`(S/M=1x1、L=2x2)、需要は `facilityAttract`(S=0.5 M=0.75 L=1)。
- **バス・航空機スプライト**: `src/assets/bus.png`(250種、1行に5デザイン)/`aircraft.png`(100種、1行に3デザイン)。`render/vehicleSprites.ts` が (種類,デザイン,方向) → Texture を返し、`transitLayer.drawBus/drawPlane` が `putTex` で置く(方向は `dirIndex` で 0=+u から45度刻み)。`VehicleModel.sprite` が車種ごとのデザイン番号(`data/models.ts` の BUS_POOLS/AIR_POOLS で割り当て)。読み込めないときは従来の手続き描画に戻る。航空機の影は `shad`(車両より下)、機体は常に他の乗り物の手前。
- **セーブ**: 地形はシードから再生成し保存しない(4096でも約0.1MB)。整地は差分(edits)だけ保存。地形生成を変えたら `TERRAIN_VERSION` を上げる(古いセーブは拒否)。セーブ形式は version 3(span層を追加)。
- **決定論**: シミュレーションは `Rng`(mulberry32, 状態保存可)のみ使用。同じ入力なら同じ結果(テストあり)。
- **車両**: 道路は(タイル,向き)の車線を1台ずつ占有(渋滞)。鉄道は経路全体を予約する簡易閉塞(単線の正面衝突を防ぐ)、終端で編成を折り返す。航空は直線飛行。
- **乗客**: 発生時に目的地を持ち、`Router` が停留所ごとに「目的地→乗る路線」を返す(停車駅数+乗り換えペナルティ6のダイクストラ)。乗り換えは「同じ停留所を共有する路線」間のみ。
- **性能**: 経路キャッシュ、目的地重みのキャッシュ、シミュレーション時間予算10ms/フレーム(超えたら速度を自動で落とす)。ベンチ: 4096・停留所約900・車両約1900で 0.33ms/tick。
- **スマホ**: `pointer: coarse` で判定。キャッシュ上限128MB、既定512、解像度上限1.5。2本指でパン+ピンチ(`Camera.multiTouch` で建設ドラッグを取り消す)。

## 6. 操作
| 操作 | 内容 |
|---|---|
| 右/中ドラッグ・WASD | 移動(移動ツールは左ドラッグも) |
| ホイール・Q/E・ピンチ | ズーム |
| R / O / T / X | 道路 / 一方通行(ドラッグ方向) / 双方向化 / 撤去 |
| B / L / K / P | バス停 / 線路 / 駅 / 空港 |
| U / J / G | 上げる / 下げる / 整地(ドラッグ範囲) |
| Enter・Esc | 路線作成の確定 / キャンセル・移動に戻る |
| Space・Ctrl+S | 一時停止 / セーブ・ロード |

路線: 右パネルの ＋🚌/＋🚆/＋✈ → 停留所を順にクリック → Enter → 「＋車両」。

## 7. 検証状況
- 自動テスト40件(地形/街/道路/経路/乗り換え/渋滞/鉄道/航空/セーブ往復/整地)すべて通過。
- ヘッドレスChromium(ソフトウェアGL)で描画・操作・セーブ往復・スマホ(iPhone 13エミュレーション)のタッチを確認。
- **未検証**: 実機GPU・実機スマホでのFPS/メモリ、サーバ(Ubuntu)での実運用、4096マップを長時間回したときの挙動。
- 開発モードでは `window.__game`(map/sim/camera/setSpeed/transitLayer)が使える。自動確認はPlaywrightで行った(スクリプトはリポジトリに含めていない)。

## 8. 既知の制約・未実装
- 乗客の乗り換えは同一停留所のみ(徒歩乗り換えなし)。
- 鉄道: 信号は一方向のみ(単線の待避線運用なし。両方向信号はデッドロックし得るので未提供)、勾配は1段スロープのみ。併合は隣接する停車中の編成同士のみ(走行中の編成を連結に向かわせる操作は未対応)。
- 航空: 直線飛行のみ。滑走路の向き・混雑・空港の拡張なし。
- 地形: 段差は1段までスロープ(斜め線路は同じ高さのみ)。橋・トンネルは直線のみ・最大12タイル。川は地形生成で固定(掘削や流路の編集なし)。
- オーダー: 停車/満載待ち/時刻表に加え、出発時の条件付きジャンプ(積載率・待ち人数・時刻)、共有オーダー、時刻表の自動作成に対応。JGRPPの「ラベル・変数・オーダーの挿入/削除/並べ替え・車両ごとの個別オーダー」は未対応。ダイヤグラム画面は不要との判断で削除済み。
- 勝敗・ランダムイベントなし(サンドボックス。経営は資金・売上・費用・融資・買収まで)。倒産・ゲームオーバーはなし(資金マイナスは評価低下のみ)。
- 古い形式のセーブは読めない。
- 日本語の街名ラベルはPixiの`Text`(ブラウザのフォント依存)。

## 9. 次の候補(優先度順の提案)
1. 実機スマホ/サーバでの性能計測と調整(HUDの sim/描画準備/車両 msを見る)。
2. 車両の見た目と音、街の見た目(建物の種類)の改善。
4. 鉄道: 単線の待避線運用、連結に向かわせる操作。
6. 画面の統計(路線別の輸送人数、街の一覧)。

## 10. 運用メモ
- 開発ブランチ `claude/exciting-johnson-gvyeow` のみに push 済み(PR は未作成)。
- `.gitignore` で .env/鍵/node_modules/dist/セーブデータ等を除外済み。秘密情報はリポジトリにない。
- ファイル数: ソース約40、コード約6,500行(lock除く)。

## 車両スプライト (bus / aircraft / train)
- 生成: `tools/vehicle-sprites/` (bus.py, aircraft.py, train.py, build_train_atlas.py)。train は 190 デザインを種別(kind)ごとに割当、先頭/最後尾=head、中間=middle、最後尾は逆向きに反転。
- サイズ調整: `src/render/vehicleSprites.ts` の `BUS_SCALE`(0.55) / `AIR_SCALE`(0.6)、鉄道は `trainDesigns.json` の design ごとの `sc`（1両≒CAR_LEN）。
- テスト 98 件。

## 巨大マップ (最大 65535×65535) — マルチプレイ構想の第1段階
- タイル層 `world/tileLayer.ts`: 一辺 ≤2048 は単一配列、超えると 64×64 チャンクの疎配列。API は `map.road.get(i)/set(i,v)`（旧 `map.road[i]` は廃止）。index = y*size+x（65535² でも double で正確。`|0` は使わず Math.floor、経路は Uint32Array）。
- 地形: 一辺 ≥8192 は `world/bigTerrain.ts` で座標+シードから必要なチャンクだけ生成（大陸の波長は一定=密度一定）。それ未満は従来の全体生成(セーブ互換)。巨大マップに川は未実装。
- 街: 巨大マップは 1024² 区画ごとに決定論的に生成（`placeTownsRegion`、カメラ周辺を1秒ごとに `Simulation.discoverNear`）。生成済み区画は `map.townRegions`（セーブに含む）。
- セーブ v4: 各層は非ゼロタイルのみ(疎)。v3 も読める。ミニマップは巨大マップでは 4096² の窓がカメラに追従。
- 次の段階: シミュレーションを Node サーバへ分離 → WebSocket 同期 → 線路共有/通行料/送金 → 100人+AI20社の負荷試験。

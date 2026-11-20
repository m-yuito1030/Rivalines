# コードの構成(アーキテクチャ)

```
依存の向き:  shared  ←  server / client      (server と client は互いに依存しない)
```

## ディレクトリ

```
src/
  shared/                     サーバーとクライアントが共有する(ブラウザ・Node のどちらでも動く純粋なコード)
    protocol.ts               通信の型(Cmd / ServerMsg / PlayerInfo)
    world/                    地図・地形・道路・線路・駅・施設・街の生成(GameMap, TileLayer, facilities, stations …)
    data/                     車種・観光地・スプライトの寸法(models.ts, *.json)
    save/                     セーブの変換(serialize, storage)
    sim/
      simulation.ts           各サービスを step() の順に呼ぶ指揮者
      network/                交通ネットワーク(下記)
      economy/                会社の経営(economy, rating, ranking, weekly, rivals, pacts, auctions, development, analysis)
      facility/               施設の来場者・街の施設・公共施設(facilityVisitors, cityBusiness, publicFacilities)
      world/                  暦・天候とイベント・人口移動(calendar, events, migration)
  client/                     ブラウザ側
    main.ts                   ゲーム画面の組み立て(startGame)
    app/                      画面の部品(auth, toast, toolbar, stationPicker, facilityPicker, bulldozeOptions, playerMenu, dom)
    connection/               サーバーとの接続(net.ts)と、届いた状態の反映(mirror.ts)
    render/                   描画(chunkRenderer, transitLayer, frontOverlay, buildingSprites, vehicleSprites, camera …)
    ui/                       各パネル(info, route, diagram, finance, list, ranking, analysis …)
    assets/ style.css
server/                       Node 側(1つの世界を進行する)
  index.ts                    HTTP / WebSocket / 進行ループ / 保存
  accounts.ts                 アカウント・署名つきトークン・プロフィール
  replicate.ts                視界ごとの配信
  commands/                   コマンドバス(下記)
tools/                        スプライト生成の Python
docs/                         ARCHITECTURE(このファイル) / MULTIPLAYER / HANDOVER / REQUIREMENTS
```

## 交通ネットワーク(`shared/sim/network/`)

`Transit` は状態(停留所・路線・車両・基地・信号)の入れ物と、登録・削除・毎tickの進行の指揮を持つ。
責務ごとの処理は、小さなサービスクラスに分け、`Transit` のフィールドとして持つ(`transit.signalsSys` など)。
サービスは `Transit` への参照だけを持ち、状態を直接は複製しない。

| ファイル | クラス | 責務 |
|---|---|---|
| `types.ts` | (型・定数) | Stop / Route / Vehicle / Depot / TransitSave、定数、RANKS |
| `signalSystem.ts` | SignalSystem | 信号・閉塞(予約) |
| `trainOps.ts` | TrainOps | 列車の分割・連結・待機中の出発 |
| `orderEditor.ts` | OrderEditor | オーダーの挿入・削除・並べ替え・路線の共有 |
| `schedule.ts` | Schedule | ダイヤ・発車案内・時刻表の自動作成・種別・路線の複製・予定経路 |
| `pathPlanner.ts` | PathPlanner | 経路探索とキャッシュ、変更範囲にかかる経路だけの再探索 |
| `dispatcher.ts` | Dispatcher | 車両の出発(経路を決めて走り出す) |
| `motion.ts` | Motion | 走行中の1tickの動き、到着・降車、位置の計算 |
| `passengerFlow.ts` | PassengerFlow | 乗客の発生・待ち人数・積み降ろし・施設の需要 |
| `mirrorSync.ts` | MirrorSync | クライアント: サーバーの状態の反映と補間 |
| `transitStore.ts` | TransitStore | セーブ・ロード |

外部のコード(UI・サーバー)が使う操作は、`Transit` に同名の薄い委譲メソッドを残してあるので、呼び出し側は変わらない。

## コマンド(`server/commands/`)

プレイヤーの操作は `Cmd`(`shared/protocol.ts`)としてサーバーに届き、`execute()`(コマンドバス)が種類ごとのハンドラに振り分ける。

- `index.ts` … ハンドラの表(`Handlers` 型がすべての `Cmd` を網羅しているかをコンパイル時に検査)と、実行・変更範囲の通知
- `context.ts` … `CommandContext`: 誰の操作か(`who`)・世界・会社・共通の近道(`charge` `mine` `facOcc`)
- `util.ts` … 失敗の結果、名前の整形、上限などの共通部品
- `build.ts`(build / bulldoze / signalLine)、`place.ts`(ensureStop / place)、`route.ts`(路線・オーダー・ダイヤ)、`fleet.ts`(車両)、`access.ts`(停留所の使用許可)、`business.ts`(広告・入札・提携・開発)、`finance.ts`(融資・送金・買収)

新しいコマンドを足すには、`Cmd` に型を足し、該当ファイルにハンドラを書き、`index.ts` の表に載せる(載せ忘れは型エラーになる)。

## 開発

- `npm run check` … 型チェック(クライアント・サーバー)+ 整形チェック(Prettier)+ テスト
- `npm run format` … 整形
- テストは対象ファイルの隣(`*.test.ts`)

## 今後の整理の候補

- `Transit.actor`(いま操作している会社を一時的に書き込む)を、メソッドの引数にする
- `render/transitLayer.ts` の駅・車両の描画をさらに分ける
- パネルの共通の基底クラス(開閉・再描画)
- ESLint の導入(TypeScript 7 に対応した版が出たら)

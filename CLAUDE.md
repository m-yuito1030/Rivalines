# Rivalines: 作業する人・エージェントへ

ブラウザで遊ぶ、交通と街づくりのマルチプレイゲーム(TypeScript + Vite + PixiJS + Vitest。サーバーが世界を持つ)。

## 必ず守ること
- **ふだんの作業の取り込み先は `develop`。`main` には取り込まない。** ブランチは `develop` から切り、PR の宛先(base)も `develop` にする。ブランチ → PR(→ develop)→ CI が緑 → Squash and merge。`main` は、リリースのときだけ、リリースをする人が `develop` から取り込む。`main` や `develop` に直接コミットしない。流れは [docs/WORKFLOW.md](docs/WORKFLOW.md)。
- 「マージして」と言われたら、宛先が `develop` の PR だけをマージする。宛先が `main` の PR は、リリースの PR(または hotfix)なので、ユーザーが「リリースして」と言ったときだけ。
- **複数のエージェントが同時に作業する。** 始める前に開いている PR・枝を確かめ、衝突しやすい場所の約束を守る: [docs/MULTI_AGENT.md](docs/MULTI_AGENT.md)。
- 版番号は機能の PR では上げない。`CHANGELOG.md` の `## [未リリース]` に 1 行足す: [docs/VERSIONING.md](docs/VERSIONING.md)。
- 出す前に `npm run check`(型・整形・テスト)。画面が変わるときは、ブラウザで動かして確かめる。
- 本稼働・VPS の再起動や再ビルドは、ユーザーの許可があるときだけ。
- コミットの作者のメールは、GitHub の noreply アドレスにする。個人のメールアドレス・名前・秘密の値を、コミット・PR・外部への通信に入れない。
- 他作品のコード・画像・文言をコピーしない。

## ユーザーへの返事
- ユーザーはコードを読まない。専門用語を避け、平易な短い日本語で書く。見出し・表・絵文字・太字を重ねない。
- できたことと、できていないこと(確かめていないこと)を、分けて正直に書く。

## 参考
- 構成: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ・ 多言語: [docs/I18N.md](docs/I18N.md) ・ 環境(本稼働と次期版): [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md) ・ 公開(VPS): [docs/DEPLOY_VPS.md](docs/DEPLOY_VPS.md) ・ 運営: [docs/OPERATIONS.md](docs/OPERATIONS.md)

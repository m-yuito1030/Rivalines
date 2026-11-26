# 開発の流れ(GitHub フロー)

枝は **`main`・`develop` と、作業用のブランチ**。小さく作って、確認して、`develop` に取り込む。`main` は、リリースしたものだけ。

```
main ─────────────────────●─────────────●───→   リリースした状態(本稼働・タグはここ)
                         /             /
develop ──●────●────●───●────●────●───●────→   ふだんの取り込み先。次期バージョンで試す
           \  /      \ /      \  /
            feature/hotel-price  fix/title-overlap   作業用(短く使い捨て)
```

- 作業用のブランチは、`develop` から切って、`develop` に PR を出す。
- `develop` が、次期バージョンで試して、よければ、**リリースの PR(`develop` → `main`)**で `main` に取り込む。
- 緊急の修正(hotfix)だけは、`main` から切って `main` に PR を出し、そのあと `main` を `develop` に取り込む(§6)。

## 1. ブランチを作る
`develop` を最新にして、作業の名前で枝を切る。

```
git switch develop && git pull
git switch -c feature/hotel-price
```

名前のつけ方: `feature/` 新しい機能 ・ `fix/` 不具合の修正 ・ `docs/` ドキュメント ・ `refactor/` 動きを変えない整理 ・ `chore/` 設定・道具

## 2. 作業してコミットする
- 1つのコミットは、1つの意味のある変更にする。
- コミットメッセージの頭に種類を付ける(日本語でよい)。
  `feat: ホテルの料金設定を追加` / `fix: スマホでウィンドウがはみ出す` / `docs: README を更新` / `refactor: ...` / `chore: ...`
- 出す前に、手元で確認する: `npm run check`(型・整形・テスト)。整形だけ直すなら `npm run format`。

## 3. プルリクエスト(PR)を出す
```
git push -u origin feature/hotel-price
```
GitHub で PR を作る(テンプレートの項目を埋める)。**宛先(base)は `develop`**(`gh pr create --base develop`)。**CI(自動のチェック)が緑になる**のを待つ。

## 4. 取り込む(マージ)
- CI が緑で、内容を確認したら、**Squash and merge**(1つにまとめて取り込む)。宛先が `develop` であることを、マージする前に確かめる。
- 取り込んだ枝は削除する。
- 自分の PC も更新する: `git switch develop && git pull`

## 5. リリース(次期バージョン → 本稼働)
`develop` は、まず**次期バージョン**として動かして試す(`develop` を取り出した状態で `scripts/up.sh next`)。遊べる状態になったら、正式リリースして本稼働にする。リリースは、**リリースをする人が 1 人だけ**行う。

1. 版を上げる PR(`package.json` と `CHANGELOG.md`。[VERSIONING.md](VERSIONING.md))を、`develop` に取り込む。
2. **リリースの PR** を出す: `gh pr create --base main --head develop --title "release: v0.4.0"`。CI が緑になったら、**Create a merge commit** で取り込む(Squash にしない。Squash にすると、`develop` と `main` の履歴が食い違って、次のリリースで衝突し続ける)。
3. `main` を取り出して、リリースする。
```
git switch main && git pull
scripts/release.sh v0.4.0
```
タグ付け・本稼働のバックアップ・本稼働の切り替え・次期バージョンのデータ消去までを行う。詳しくは `docs/ENVIRONMENTS.md`。GitHub の Releases に、変更点を書いて公開する。

## 6. 緊急の修正(hotfix)
本稼働で、すぐ直したい不具合があるときだけ。
1. `main` から `hotfix/名前` を切って、`main` に PR を出す(CI が緑なら Squash and merge)。
2. `scripts/release.sh v0.4.1` で本稼働に出す。
3. **`main` を `develop` に取り込む**: `gh pr create --base develop --head main`(Create a merge commit)。これを忘れると、直したものが次のリリースで消える。

## ルール
- **`main` にも `develop` にも、直接コミットしない**。必ず PR 経由。
- **ふだんの PR の宛先は `develop`。`main` への PR は、リリースと hotfix だけ。**
- `develop`・`main` を壊したら、直すより先に**直前の状態に戻す**(`git revert`)。
- 履歴の書き換え(`git push --force`、`filter-branch`)は `main`・`develop` では行わない。
- 秘密(パスワード・トークン・個人のアドレス)をコミットしない。万一入れたら、すぐ無効にする(取り消しても履歴には残るため)。
- 作者のメールアドレスは GitHub の noreply アドレスを使う(`git config user.email` に設定済みか確認)。

## GitHub 側で一度だけする設定(リポジトリの Settings)
1. **Branches** → Branch protection rule(`main` と `develop` のそれぞれ)を追加
   - Require a pull request before merging
   - Require status checks to pass before merging → `check`(CI の名前)を選ぶ
   - Do not allow bypassing the above settings
2. **General** → Pull Requests
   - Allow squash merging をオン(ふだんの PR 用)。`develop` と `main` の間の PR だけ、Allow merge commits もオンにする(リリースと hotfix の取り込み用。使うのは、そのときだけ)
   - Automatically delete head branches をオン(`develop` は消えない設定にする)
3. **Branches** → 既定のブランチ(Default branch)を `develop` にする(PR の宛先の初期値が `develop` になり、`main` への取り違えを防ぐ)
3. **Actions** → General → Workflow permissions は Read repository contents(既定)のままで十分

## 他のエージェント・共同作業者と同時に作業するとき
詳しい決まりは [MULTI_AGENT.md](MULTI_AGENT.md)。要点:
- それぞれ別のブランチで作業する(同じ枝に同時に書かない)。
- 取り込む前に `git fetch && git rebase origin/main`(または GitHub の「Update branch」)で最新の `main` に合わせてから、衝突を直す。

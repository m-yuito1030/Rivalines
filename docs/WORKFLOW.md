# 開発の流れ(GitHub フロー)

枝は **`main` と、作業用のブランチ**だけ。小さく作って、確認して、`main` に取り込む。

```
main ────●──────────●──────────●───→   いつでも動く状態。遊ぶ・公開するのはここ
          \        / \        /
           feature/hotel-price  fix/title-overlap      作業用(短く使い捨て)
```

## 1. ブランチを作る
`main` を最新にして、作業の名前で枝を切る。

```
git switch main && git pull
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
GitHub で PR を作る(テンプレートの項目を埋める)。**CI(自動のチェック)が緑になる**のを待つ。

## 4. 取り込む(マージ)
- CI が緑で、内容を確認したら、**Squash and merge**(1つにまとめて取り込む)。
- 取り込んだ枝は削除する。
- 自分の PC も更新する: `git switch main && git pull`

## 5. リリース(公開版の区切り)
遊べる状態で区切りたいときは、`main` にタグを付ける(番号は `v主.副.修正`)。

```
git switch main && git pull
git tag v0.1.0
git push origin v0.1.0
```
GitHub の Releases で、変更点を書いて公開する。サーバーへの反映は `docker compose up -d --build`(そのときの `main` を使う)。

## ルール
- **`main` に直接コミットしない**(最初の設定だけは例外)。必ず PR 経由。
- `main` を壊したら、直すより先に**直前の状態に戻す**(`git revert`)。
- 履歴の書き換え(`git push --force`、`filter-branch`)は `main` では行わない。
- 秘密(パスワード・トークン・個人のアドレス)をコミットしない。万一入れたら、すぐ無効にする(取り消しても履歴には残るため)。
- 作者のメールアドレスは GitHub の noreply アドレスを使う(`git config user.email` に設定済みか確認)。

## GitHub 側で一度だけする設定(リポジトリの Settings)
1. **Branches** → Branch protection rule(`main`)を追加
   - Require a pull request before merging
   - Require status checks to pass before merging → `check`(CI の名前)を選ぶ
   - Do not allow bypassing the above settings
2. **General** → Pull Requests
   - Allow squash merging だけオン、Automatically delete head branches をオン
3. **Actions** → General → Workflow permissions は Read repository contents(既定)のままで十分

## 他のエージェント・共同作業者と同時に作業するとき
- それぞれ別のブランチで作業する(同じ枝に同時に書かない)。
- 取り込む前に `git fetch && git rebase origin/main`(または GitHub の「Update branch」)で最新の `main` に合わせてから、衝突を直す。

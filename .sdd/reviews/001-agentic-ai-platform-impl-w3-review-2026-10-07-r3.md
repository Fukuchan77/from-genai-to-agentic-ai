# 001-agentic-ai-platform W3 実装 敵対的レビュー round 3（2026-10-07）

- 対象: round 2（`.sdd/reviews/001-agentic-ai-platform-impl-w3-review-2026-10-07-r2.md`、REQUEST_CHANGES、N1〜N7）の修正 `2f06c44..41e5285`（`git log --oneline 80179a1..41e5285` の5件）と、W3 全体の差分 `git diff 86575ae..41e5285`（61 コミット）。HEAD は `41e5285`（ブランチ `claude/project-thread-xt048t`）
- 実施者: W3 の実装にも r1・r2 の修正にも関わっていない新しいコンテキスト（`sdd-reviewer`、`adversarial-review` skill）
- 実測:
  - `mise run gate -- --force` は exit 0 だった（turbo のキャッシュは 0 件）。root 257/257、ai-core 687 passed / 4 skipped（39 ファイル）、eval-suite 3 passed / 1 skipped、`tool-risk-declared: scanned 13 FILES`
  - `mise run test:mutation` は exit 0 だった（スコア 91.60、閾値 70）
  - `pnpm exec stryker run --mutate packages/ai-core/src/summarize/plan.ts` のスコアは 91.30 だった（killed 131、survived 12、no coverage 2）
- 独立 probe:
  - 一時ディレクトリ `packages/ai-core/src/zzr3probe/` に検証用テストを置いて実行し、終了時に削除した
  - undici の probe スクリプトはスクラッチパッドに置いた
  - 実装を一時的に壊して既存テストが失敗するかを確かめた。対象は N1、N5、N7 の各分岐。いずれも `mktemp` の一意な名前でバックアップし、`cmp` で復元を確認した
  - 終了時に `git status --short` が空であることを確認した
- risk_trigger: なし（手動の round 3）。prior_reviews は r1 と r2（対応記録を含む）

## Round 2 指摘の対応確認

| # | 重大度 | 指摘 | 対応確認 | 根拠 |
|---|---|---|---|---|
| N1 | MEDIUM | 推論の再送で OpenAI が生の推論テキストを警告に出す | fixed | 下の「N1 の確認」を参照 |
| N2 | MEDIUM | 公開 DNS 名で内部アドレスへ到達できる | deferred（記録は具体的。設計に誤りが2点ある → 新規 R3-1） | 下の「N2・N3 の確認」を参照 |
| N3 | LOW | 本文の上限が全量を読んだ後に検査される | deferred（正しく記録） | 下の「N2・N3 の確認」を参照 |
| N4 | LOW | `num_ctx` を要約にだけ渡す。メモリと再読み込みが未実測 | deferred（正しく記録） | 下の「N4 の確認」を参照 |
| N5 | LOW | 無効な `Location` で `TypeError` が漏れる | fixed | 下の「N5 の確認」を参照 |
| N6 | LOW | 統合の見積もりと `chunkBudgetTokens` の変異が生き残る | fixed | 下の「N6 の確認」を参照 |
| N7 | LOW | LAN の名前と、IPv4 を埋め込む IPv6 の一部を許可する | fixed（Fix の提案からの逸脱は妥当） | 下の「N7 の確認」と「N7 の逸脱の評価」を参照 |

### N1 の確認

- `adapt-history.ts:64-69` では、`reasoning` と `reasoning-file` が出所に関係なく `undefined` を返す。
- 旧規則（`sameProvider && target.capabilities.reasoning ? copy : undefined`）に戻すと6件が失敗した。内訳は次のとおり。
  - 4プロバイダそれぞれの推論の除外
  - provider フィールドの除去
  - 実際の `createOpenAI` に fetch を注入した replay のテスト（`AI_SDK_LOG_WARNINGS` の収集に推論テキストが含まれない）
- このテストは、本番と同じ `generateText` → `@ai-sdk/openai` の変換経路を通る。偽の合格ではない。
- `@ai-sdk/*` の dist で `JSON.stringify(part)` を警告文に入れる箇所を走査した。該当は openai / azure の推論の2か所だけで、どちらも推論が届かなくなったので発火しない。provider-utils の該当箇所はストリームの直列化で、警告ではない。
- ADR-7（research.md）、plan C11、Error Handling、tasks.md 17 のノートは、コードと一致している。

### N2・N3 の確認

- 記録先は次のとおり。
  - plan C13（plan.md:273）
  - tasks-w4 の 20.1。テストの列挙（`127.0.0.1`、`169.254.169.254`、`::1`、`::ffff:10.0.0.1`、rebinding、上限ちょうどと1バイト超、`Content-Length` の事前拒否）と、`_Boundary:_` の `summarize/index.ts` の公開を含む
  - traceability の Gaps（同じ LAN の第三者の脅威を明記）
  - url-guard.ts の冒頭コメント
- 記録は具体的で、テスト付きの要件になっている。
- (b) の読み込み中の打ち切りは成り立つ。カウントする TransformStream が `SourceFetchError` で error になると、`Response.text()` は同じオブジェクトで reject する（probe で `instanceof` が true）。そのため `fetchOnce` の `PlatformError` の分岐でそのまま伝わる。
- (a) には誤りが2点ある → R3-1。

### N4 の確認

- tasks-w5 29.2 に、交互呼び出しでのモデル再読み込みの時間とメモリ量の実測と、`_Verify:_` への記録が加わった。
- 結果が大きい場合に plan C8・C11 へ起票することも明記されている。
- tasks.md 18 のノートと traceability の (3)(4) も同じ内容である。

### N5 の確認

- `source.ts:211-217` の `resolveLocation` は、`new URL` の失敗を `SourceFetchError("disallowed-url")` に変換する。
- catch で `TypeError` を投げ直すと、新しいテスト（`calls` 1回を検査する）が失敗した。

### N6 の確認

- Stryker を再実行した結果、r2 で指摘した `206:49`、`209:23`、`99:9` は生存一覧から消えた（kill された）。
- 残る12件の生存は、do.md の記録（47、49、51、114、134、149×2、155、156、162、192）と一致した。
- 新しいテストの期待値は、実際の空のプロンプトを `buildChunkPrompt` / `buildSummaryPrompt` / `buildIntegrationPrompt` から組み立てて導いている。実装の出力を写したトートロジーではない。

### N7 の確認

- 次の分岐を個別に無効化し、それぞれでテストが失敗することを確かめた。
  - 6to4、Teredo、ローカル用 NAT64 の各分岐: それぞれ3件が失敗
  - SIIT: 2件が失敗
  - `lan`: 2件が失敗
- probe で次を確認した。
  - 拒否された: `[::ffff:0:7f00:1]`、`[2002:7f00:1::]`、`[2002:a9fe:a9fe::]`、`[64:ff9b:1::7f00:1]`、`[2001:0:4136:e378::1]`、`router.lan`、`x.home.arpa.`、`127.0.0.1.`
  - 許可された: `[2002:808:808::]`

### N7 の逸脱の評価

r2 の Fix は「ローカル用 NAT64 と SIIT は埋め込みの IPv4 で判定し、6to4 と Teredo は丸ごと拒否する」だった。実装はこれと次の2点が逆で、どちらも妥当と判断した。

- **6to4 は埋め込みの IPv4 で判定する**: RFC 3056 の 6to4 では、IPv4 が `2002:VVVV:WWWW::/48` の固定の位置にあり、到達先はその IPv4 である。公開の IPv4 を埋め込んだものだけを許可すれば、安全性は丸ごと拒否する場合と同等で、誤検知が少ない。
- **ローカル用 NAT64 は丸ごと拒否する**: RFC 8215 の `64:ff9b:1::/48` はローカル用で、グローバルには到達できない。RFC 6052 では、埋め込みの位置がプレフィックス長（/48〜/96）で変わるため、位置を固定した判定はできない。丸ごと拒否するほうが r2 の提案より保守的で正しい。

SIIT と Teredo は提案のとおりである。

## Critique（新規指摘）

### [LOW] R3-1: N2 の先送り先（plan C13・tasks-w4 20.1）の設計の (a) に誤りが2点あり、記載どおりに実装するとテストが失敗するか、迂回が残る
**Location**: specs/001-agentic-ai-platform/plan.md:273; specs/001-agentic-ai-platform/tasks-w4.md:43（20.1）; packages/ai-core/src/summarize/url-guard.ts:108-122; source.ts:170-175
**Issue**: 次の2点の誤りがある。
1. 指定されている `isBlockedHostname` は、WHATWG で正規化された `URL.hostname`（IPv6 は角括弧つき、16進に圧縮済み）を前提にしている。名前解決の結果のアドレス（角括弧なし、mapped 形式は `::ffff:a.b.c.d`）をそのまま渡すと、次のように誤判定する。
   - `::ffff:10.0.0.1`、`::ffff:127.0.0.1`、`::ffff:169.254.169.254` は ALLOWED になる（ドットを含むため「単一ラベル」の分岐に入らない）
   - 公開の `2606:4700::1111` は、単一ラベルとみなされて BLOCKED になる
2. 「拒否は `SourceFetchError("disallowed-url")` で投げ、C12 の `fetchOnce` がそのまま伝える」と書かれているが、例に挙げた undici の `Agent({ connect: { lookup } })` の lookup で投げたエラーは、`TypeError: fetch failed`（`cause` が元のエラー）に包まれる。そのため `fetchOnce` の `cause instanceof PlatformError` に当たらず、`network` になる。

**Evidence**:
- probe で `isBlockedHostname("::ffff:10.0.0.1")` は ALLOWED、`isBlockedHostname("2606:4700::1111")` は BLOCKED だった。
- undici@7.30.0 の `Agent` の lookup のコールバックに独自のエラーを渡すと、undici の fetch でも Node の global fetch でも `TypeError fetch failed | instanceof SFE: false | cause SFE: true` になった。
- tasks-w4 20.1 のテストの列挙には `::ffff:10.0.0.1` → `disallowed-url` があるため、W4 で TDD を守れば両方とも RED で見つかる。実害は W4 の手戻りに限られ、その分重大度を下げた。

**Confidence**: high
**Fix**: plan C13 と tasks-w4 20.1 の (a) を、次の内容に直す。
- ai-core から、アドレス専用の判定関数（例: `isBlockedAddress(ip)`）を公開する。中身は `net.isIP` で種別を判定し、IPv6 は `new URL(\`http://[${ip}]\`).hostname` で正規化してから既存の規則に通す（`_Boundary:_` に `url-guard.ts` と `url-guard.test.ts` を加える）。
- `guardedFetch` は `TypeError` の `cause` が `SourceFetchError` なら、それを投げ直すと明記する。
- テストに「公開の IPv6 に解決される名前は通る」を加える。

### [LOW] R3-2: traceability・do.md・r2 の対応記録が引くコミットハッシュの一部が、このブランチに存在しない
**Location**:
- specs/001-agentic-ai-platform/traceability.md:72,91,92,161
- specs/001-agentic-ai-platform/pdca/do.md:3470,3476,3482,3488,3498,3174
- .sdd/reviews/001-agentic-ai-platform-impl-w3-review-2026-10-07-r2.md:134-141
- traceability.md:110,119

**Issue**: 次の2種類の不整合がある。
- N1、N5、N6、N7 のコミットとして記録されている `c44a2c6`、`ef2484f`、`7accbd5`、`6beaa8e` は、HEAD の祖先ではない。`worktree-agent-a19867ca15217d4eb` にだけある rebase 前の SHA で、ブランチ上の実体は `2f06c44`、`c8da4d5`、`48299db`、`03962c2` である（`git patch-id --stable` は各組で一致した）。
- T-15.1 の `90bc262` は、リポジトリのどこにもない。実体は `90a1b03` `feat(ai-core): add ACI tool types and defineAciTool ... (15.1)` である。

**Evidence**:
- `git merge-base --is-ancestor <sha> HEAD` が、上の5つの SHA ですべて失敗した。
- `git cat-file -t 90bc262` は `fatal: Not a valid object name` だった。
- worktree のブランチが削除されて gc されると、記録のハッシュは解決できなくなる（traceability の Commit 列の追跡性が失われる）。

**Confidence**: high
**Fix**: 上記の4か所の SHA をブランチ上の SHA に置き換え、`90bc262` を `90a1b03` に直す。再発を防ぐには、`.sdd/` と `specs/` に書かれた7桁の SHA が HEAD の祖先であることを検査するスクリプトを、gate の repo ガードに加えることを検討する。

### [LOW] R3-3: 公開インターネットで経路のない特殊用途のアドレスの一部が、まだリテラルで許可される
**Location**: packages/ai-core/src/summarize/url-guard.ts:24-36,99-104
**Issue**: probe で次が ALLOWED だった。
- IPv6:
  - `2001:db8::/32`（文書用、RFC 3849）
  - `3fff::/20`（文書用、RFC 9637）
  - `2001:2::/48`（ベンチマーク用）
  - `100::/64`（discard、RFC 6666）
  - `5f00::/16`（SRv6 SID）
  - ISATAP 形式の `[2001:4860::5efe:7f00:1]`
- IPv4: `192.88.99.0/24`（廃止された 6to4 リレーの anycast）
- 名前: `kubernetes.default.svc`（r2 の probe の一覧にあり、N7 の Fix の対象外）

**Evidence**: いずれもグローバルには経路がないため、到達できるのは学習者の環境に独自の経路やリゾルバがある場合だけである。`.svc` などの名前は、W4 20.1 の解決後の IP の検査（R3-1 の修正後）で防げる。リテラルのアドレスは解決を経ないが、解決後の検査が同じ規則を使えば同じ扱いになる。
**Confidence**: medium（実害は環境に依存し、低い）
**Fix**: IANA の IPv6 / IPv4 Special-Purpose Address Registry のうち「Globally Reachable = False」のものを、`BLOCKED_IPV4_RANGES` と IPv6 の判定に表として加える（出典の版を記載する）。受け入れる場合は、traceability の Gaps に1行記録する。

### W3 全体の差分で MEDIUM 以上を探した結果

- 次の観点を確認し、MEDIUM 以上の新しい問題は見つからなかった。
  - request-schema、calculator（式長 200、括弧 64 段）、stop-conditions、guarded-agent、adapt-history、summarize の各モジュール
- `messages` の件数とリクエスト本文サイズの上限は、request-schema にはないが、plan C14 の `guardRequest`（tasks-w4 21.2、413 と 400）で担う設計になっているため、指摘しない。
- tasks.md の W3 サブタスク（14.1〜19.3）はすべて `[x]` で、`- [ ]` は0件だった。大タスク 14〜19 の6つすべてに Implementation Notes が記入されている（tasks.md:165,211,251,285,334,370）。
- traceability の件数（`adapt-history.test.ts` 36件、`plan.test.ts` 27件、`url-guard.test.ts` 82件）は、実測の件数と一致した。
- plan C11、C12、C13、Error Handling と research ADR-7 は、修正後のコードと一致している。ただし C13 の (a) は R3-1 を参照。

## Verdict
APPROVE

r2 の N1・N5・N6・N7 はコードとテストで修正されていた。いずれも実装を壊すとテストが失敗し、偽の合格ではないことを確かめた。N2・N3・N4 は、W4・W5 のテスト付きの要件として具体的に記録されている。新規の指摘は LOW の3件（R3-1〜R3-3）だけである。R3-1 は W4 に着手する前に plan C13 と tasks-w4 20.1 を直すことを推奨する。R3-2 は記録の修正だけで済む。

## Hallucination Signal
forced: false

## 対応記録（2026-10-07）

- R3-1: plan C13 と tasks-w4 20.1 を修正した（生の IP を `new URL(...).hostname` で正規化してから `isBlockedHostname` に渡す、undici の `TypeError: fetch failed` の `cause` を `disallowed-url` に変換する、公開 IPv6 `2606:4700::1111` が通るテスト）。`docs(sdd): record W3 review round 3 and its fixes`。
- R3-2: traceability.md・pdca/do.md・r2 の対応記録の `c44a2c6`・`ef2484f`・`7accbd5`・`6beaa8e` を `2f06c44`・`c8da4d5`・`48299db`・`03962c2` に、`90bc262` を `90a1b03` に置換した（同じコミット）。
- R3-3: 受け入れた制約として traceability の Gaps に記録した（公開経路がなく、内部の DNS や経路設定がある環境では W4 20.1 の接続時検査で扱う）。


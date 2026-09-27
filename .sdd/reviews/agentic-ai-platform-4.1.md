# Task 4.1 独立敵対的レビュー

**対象**: `tooling/vitest/setup-hermetic.ts`、`tooling/vitest/setup-hermetic.test.ts`、Task 4.1 / plan C18 / Req 2.11、現在の未コミット差分。

**確認日**: 2026-09-27

**リスクトリガーの確認**: Task 4.1 の `_Boundary:_` 外で `specs/001-agentic-ai-platform/tasks.md` と `specs/001-agentic-ai-platform/pdca/do.md` が変更されている。前者は Task 4.1 のチェックを `[ ]` から `[x]` にした1箇所、後者は RED / GREEN / PROVE / 検証履歴の追記だけで、要件・設計・実装スコープを変更していない。`sdd-impl` の完了状態更新と PDCA 記録に必要な管理変更であり、境界逸脱としては扱わない。ただし、以下の阻害事項が残るため `[x]` は時期尚早である。

**独立検証**:

- `mise run typecheck`: 1 task successful。
- `mise run gate`: exit 0、Biome は9ファイルを走査。ただし現段階の gate は lint のみ。
- `git diff --check`: exit 0。
- 一時 Vitest config による対象テスト: 1 file / 7 tests passed。
- 復元確認: 実際に置換された `fetch`、`Socket.prototype.connect`、callback/promise `lookup` は `restoreHermeticNetworkGuards()` 後に元の参照へ戻った。
- 追加の独立プローブでは、`resolve4` / `resolve6`、ESM named import、`Resolver` インスタンスから遮断を迂回でき、`net.connect` / `createConnection` の正規化済み引数を誤解釈することを確認した。

## Critique

### [HIGH] 最も一般的な `resolve4` / `resolve6` が実装とテストの両方から漏れている
**Location**: `tooling/vitest/setup-hermetic.ts:7`, `tooling/vitest/setup-hermetic.test.ts:11-16`
**Issue**: `resolve*` の列挙条件が数字始まりの接尾辞を除外するため、callback版・promise版の `resolve4` と `resolve6` が実通信可能なままである。
**Evidence**: 実装の正規表現は `^resolve(?:$|[A-Z])` であり、`4` と `6` は `[A-Z]` に一致しない。テストも同じ条件を複製しているため自己整合的に green になる。Node 26.10.0 で `Object.keys(dns)` には `resolve4` / `resolve6` が存在する一方、テストの `resolveMethodNames` には含まれなかった。独立実行では guard 導入後も `dns.resolve4("localhost", ...)` が `NetworkBlockedError` を投げずに返り、`dnsPromises.resolve4("localhost")` は guard ではなく実 DNS 経路由来の `ECONNREFUSED` で失敗した。これは plan C18 の「`resolve*`」および Req 2.11 の「名前解決を含む外部接続を即座に失敗」に違反する。
**Confidence**: high
**Fix**: `resolve` で始まる実際の解決関数を `resolve4` / `resolve6` を含めて列挙する。テスト側は実装と同じ正規表現を複製せず、必須名 `resolve4` / `resolve6` を明示 assertion し、callback版・promise版の双方が `NETWORK_BLOCKED` と接続先を返すことを検証する。

### [HIGH] `node:dns` の ESM named import が guard を迂回する
**Location**: `tooling/vitest/setup-hermetic.ts:189-230`
**Issue**: default export オブジェクトだけを書き換え、Node の builtin ESM named exports を同期していないため、`import { lookup } from "node:dns"` 等は元関数を呼び続ける。
**Evidence**: 実装は `dns.lookup = ...`、`dnsPromises.lookup = ...`、`mutableDns[name] = ...` と default export を変更するだけで、`node:module` の `syncBuiltinESMExports()` を呼んでいない。独立プローブでは setup import 後も、`import { lookup } from "node:dns"` と `import { lookup as lookupPromise } from "node:dns/promises"` が `localhost` を `::1` に解決した。namespace import (`import * as dns`) でも同じ結果だった。現在のテストは default import だけを使うため、この実運用上の迂回を検出しない。
**Confidence**: high
**Fix**: builtin export の置換後と復元後に named exports を正しく同期するか、named/default/namespace の全 import 形態を確実に遮断できる別方式を採用する。少なくとも callback・promise の `lookup` と代表的な `resolve*` について、別モジュールから named import した関数が遮断され、復元後に元へ戻る統合テストを追加する。

### [HIGH] `dns.Resolver` / `dns.promises.Resolver` が完全な未遮断経路になっている
**Location**: `tooling/vitest/setup-hermetic.ts:157-240`
**Issue**: module-level の `lookup` / `resolve*` だけを差し替え、Resolver インスタンスの `resolve*` メソッドを扱わないため、カスタム resolver から名前解決を実行できる。
**Evidence**: 実装には `dns.Resolver.prototype` と `dnsPromises.Resolver.prototype` の保存・置換・復元がない。独立プローブで両 prototype の `resolve4` を安全なスタブにしてから guard を導入したところ、`new dns.Resolver().resolve4(...)` と `new dnsPromises.Resolver().resolve4(...)` はどちらもスタブ結果 `203.0.113.1` を返し、`NetworkBlockedError` を通らなかった。Req 2.11 は API 名の限定ではなく「名前解決を含むモックされていない外部接続」を禁止しているため、この公開 API は対象に含まれる。
**Confidence**: high
**Fix**: callback版・promise版 `Resolver` の全ネットワーク解決メソッドを保存して guard し、`restoreHermeticNetworkGuards()` で正確に復元する。module-level 関数とは別に、Resolver インスタンス経路を列挙する非空虚テストを追加する。

### [HIGH] `net.connect` / `createConnection` の正規化済み引数を誤読し、接続先表示と Ollama 例外を壊す
**Location**: `tooling/vitest/setup-hermetic.ts:96-118`, `tooling/vitest/setup-hermetic.ts:178-187`, `tooling/vitest/setup-hermetic.test.ts:43-55`, `tooling/vitest/setup-hermetic.test.ts:129-169`
**Issue**: `Socket.prototype.connect` を直接呼ぶ形しか解析できず、公開 API `net.connect` / `net.createConnection` が渡す配列形式を `localhost` と誤認するため、エラーに実接続先が出ず、local の正しい Ollama 宛ても拒否する。
**Evidence**: Node 26.10.0 の `net.connect({ host: "127.0.0.1", port: 11434 })` は prototype に `[[{ host: "127.0.0.1", port: 11434 }, null]]` を渡す。`socketDestination()` は配列を通常 object として扱い、`host` / `port` を見つけられず `localhost` を返す。独立プローブでは mock モードの `net.connect({host:"127.0.0.1",port:9})` が `destination: "localhost"` となり、local モードで正しい `127.0.0.1:11434` を指定した `net.connect` の両 overload も `NetworkBlockedError: ... localhost` で拒否された。テストは `new net.Socket().connect(...)` のみで、top-level API を通していない。
**Confidence**: high
**Fix**: Node が渡す正規化済み引数配列を展開してから既存 overload を解析し、要求された host/path/port を保持する。`net.connect` と `net.createConnection` の object / numeric overload を明示的にテストし、mock では正しい destination で拒否、local では設定済み host+port のみ元 API へ委譲、別 port/host は拒否することを検証する。

## Verdict
REQUEST_CHANGES

## Hallucination Signal
forced: false

---

## Re-review（2026-09-27）

**対象**: 前回レビュー後の `tooling/vitest/setup-hermetic.ts` / `setup-hermetic.test.ts`、管理ファイル差分、前回4指摘への修正。

**前回指摘の解決状況**:

1. `resolve4` / `resolve6` 漏れ: **解決**。module-level callback / promise と Resolver callback / promise の `resolve4` / `resolve6` を含む `resolve*` が遮断される。
2. ESM named / namespace binding の迂回: **解決**。install / restore の双方で `syncBuiltinESMExports()` が実行され、named binding と namespace binding が guard の状態へ追随する。
3. callback / promise Resolver の迂回: **解決**。両 `Resolver.prototype` の全 `resolve*` と `reverse` を保存・置換・復元する。
4. top-level `net.connect` / `createConnection` の引数誤認: **解決**。Node が prototype へ渡す正規化済み配列を展開して destination を算出し、元引数は変更せず委譲する。

**独立検証結果**:

- 対象 Vitest: **1 file / 9 tests passed**。
- `mise run typecheck`: **1 task successful**。
- `mise run gate`: **exit 0**、Biome は9ファイルを走査し修正なし。
- `git diff --check`: **exit 0**。
- `resolve4` / `resolve6`: callback / promise の module-level API が mock で即時遮断され、元スタブは呼ばれなかった。
- ESM binding: default、named import、namespace import の `lookup` / `resolve4`（callback / promise）が mock で同じ `NETWORK_BLOCKED` と destination を返した。
- Resolver: callback / promise の `resolve4`、加えて実 Node prototype 上の `resolve6` / `resolveAny` / `reverse` が mock で遮断された。
- top-level net: `net.connect` / `net.createConnection` は mock で要求した host:port をエラーへ保持し、local では `127.0.0.1:11434` のみ元 `Socket.prototype.connect` へ委譲した。別 port と別 hostname は拒否された。
- local DNS / Resolver: named / namespace binding と callback / promise Resolver は、設定済み Ollama hostname `127.0.0.1` だけを元スタブへ委譲し、`localhost` は拒否した。
- restore: `Socket.prototype.connect`、module-level callback / promise の `lookup` / `resolve4` / `resolve6`、callback / promise `Resolver.prototype.resolve4`、ESM named / namespace binding が、導入前に取得した同一参照へ戻ることを確認した。実 Node の Resolver prototype 全15解決メソッドについても復元後の参照一致を確認した。
- local 例外の過剰許可は確認しなかった。fetch は origin、socket は正規化 hostname + port、DNS / Resolver は正規化 hostname の一致に限定される。
- Task boundary 外の `tasks.md` / `pdca/do.md` は、完了状態とレビュー修正証跡だけの必須管理更新であり、機能スコープの逸脱ではない。

### [LOW] namespace・local Resolver・restore の組み合わせは恒久テストとして直接固定されていない
**Location**: `tooling/vitest/setup-hermetic.test.ts:124-155`, `tooling/vitest/setup-hermetic.test.ts:176-218`
**Issue**: 現在の9テストは named binding と mock Resolver を検証するが、namespace binding、Resolver の local 委譲、全 hook の参照復元を明示 assertion していない。
**Evidence**: 独立プローブでは全経路が成功し、現在の実装不良は確認しなかった。一方、恒久テストの ESM ケースは `namedDnsLookup` / `namedDnsResolve4`、Resolver ケースは mock での拒否だけであり、`import * as dns`、local Resolver 委譲、restore 後の参照一致はテスト本文にない。
**Confidence**: high
**Fix**: Task 4.1 の受け入れを阻害しない任意改善として、独立プローブの namespace・local Resolver・restore assertion を既存テストへ統合する。

## Re-review Verdict
APPROVE_WITH_NOTES

## Re-review Hallucination Signal
forced: false

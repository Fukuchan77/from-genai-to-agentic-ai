import { describe, expect, it } from "vitest";
import { CREDENTIAL_KINDS, type CredentialKind, detectCredentialShapes } from "./credentials";

// Every value below is an obviously fake placeholder, assembled so that no secret scanner and no
// provider-specific rule matches this file.
const FAKE = {
	password: "Fake-Pw-0001",
	temporary: "Temp-Fake-0002",
	apiKey: ["sk", "fake", "0000000000000000"].join("-"),
	token: ["ghp", "FAKE0000000000000000000000000000000000"].join("_"),
};

function kinds(text: string): readonly CredentialKind[] {
	return detectCredentialShapes(text);
}

describe("detectCredentialShapes", () => {
	describe("plaintext passwords", () => {
		it.each([
			`パスワードは ${FAKE.password} です`,
			`パスワード：${FAKE.password}`,
			`パスワードは「${FAKE.password}」に変更しました`,
			`Your password is ${FAKE.password}.`,
			`password: ${FAKE.password}`,
			`PASSWORD=${FAKE.password}`,
		])("detects %s", (text) => {
			expect(kinds(text)).toEqual(["plaintext-password"]);
		});
	});

	describe("temporary passwords", () => {
		it.each([
			`仮パスワードは ${FAKE.temporary} です`,
			`仮パスワード: ${FAKE.temporary}`,
			`一時パスワード：${FAKE.temporary}`,
			`初期パスワードは「${FAKE.temporary}」です`,
			`Temporary password: ${FAKE.temporary}`,
			`one-time password = ${FAKE.temporary}`,
		])("detects %s as a temporary password only", (text) => {
			expect(kinds(text)).toEqual(["temporary-password"]);
		});
	});

	describe("API keys", () => {
		it.each([
			`APIキーは ${FAKE.apiKey} です`,
			`API キー: ${FAKE.apiKey}`,
			`api_key=${FAKE.apiKey}`,
			`こちらをお使いください: ${FAKE.apiKey}`,
			`AKIA${"FAKE0000FAKE0000".toUpperCase()}`,
		])("detects %s", (text) => {
			expect(kinds(text)).toEqual(["api-key"]);
		});
	});

	describe("access tokens", () => {
		it.each([
			`アクセストークンは ${FAKE.token} です`,
			`access_token: ${FAKE.token}`,
			`Authorization: Bearer ${FAKE.token.replace("ghp_", "tok_")}`,
			`token=${FAKE.token}`,
			`こちらをお使いください: ${FAKE.token}`,
			["eyJ" + "fakehead0000", "eyJ" + "fakebody0000", "fakesig0000"].join("."),
		])("detects %s", (text) => {
			expect(kinds(text)).toEqual(["access-token"]);
		});
	});

	it("detects a key or a token by its label alone when the value has no known prefix", () => {
		expect(kinds("APIキーは fake0000value0000 です")).toEqual(["api-key"]);
		expect(kinds("secret key = fake0000value0000")).toEqual(["api-key"]);
		expect(kinds("アクセストークンは fake0000value0000 です")).toEqual(["access-token"]);
		expect(kinds("access token: fake0000value0000")).toEqual(["access-token"]);
	});

	it("returns every kind found once, in a fixed order", () => {
		const text = `${FAKE.apiKey} と 仮パスワード: ${FAKE.temporary}、パスワードは ${FAKE.password}、${FAKE.token}、${FAKE.apiKey}`;
		expect(kinds(text)).toEqual([
			"plaintext-password",
			"temporary-password",
			"api-key",
			"access-token",
		]);
	});

	it("does not let a temporary password also count as a plain password", () => {
		expect(kinds(`仮パスワードは ${FAKE.temporary} です`)).not.toContain("plaintext-password");
	});

	describe("ordinary text", () => {
		it.each([
			"パスワードは設定画面の「アカウント」から変更できます。",
			"パスワードを忘れた場合は、ログイン画面の「再設定」を押してください。",
			"仮パスワードは管理者から別の連絡手段でお知らせします。",
			"パスワードは 8 文字以上にしてください。",
			"Password: required",
			"APIキーの発行は管理画面から申請してください。",
			"アクセストークンの有効期限は 1 時間です。",
			"トークン数の上限は 4000 です。",
			"VPN の接続手順: 1. アプリを起動する 2. サーバーを選ぶ",
			"パスワード: <ここに入力>",
			"パスワード: ********",
			"パスワードは https://id.example.com/reset から再設定してください。",
			"パスワードを https://portal.example.com で変更します。",
			"パスワードは case-sensitive です。",
			"The token is automatically refreshed every hour.",
			"API key is managed-by-the-admin-console",
			"",
		])("does not flag %s", (text) => {
			expect(kinds(text)).toEqual([]);
		});
	});

	it("never returns the value, only the kind names", () => {
		const text = `パスワードは ${FAKE.password}、APIキー: ${FAKE.apiKey}、${FAKE.token}`;
		const result = kinds(text);
		const serialized = JSON.stringify(result);
		for (const value of Object.values(FAKE)) expect(serialized).not.toContain(value);
		for (const kind of result) expect(CREDENTIAL_KINDS).toContain(kind);
	});

	it("is not confused by a very long line without a credential (no catastrophic backtracking)", () => {
		const started = Date.now();
		expect(kinds(`パスワード${"は ".repeat(20_000)}`)).toEqual([]);
		expect(kinds("a".repeat(200_000))).toEqual([]);
		expect(Date.now() - started).toBeLessThan(1_000);
	});
});

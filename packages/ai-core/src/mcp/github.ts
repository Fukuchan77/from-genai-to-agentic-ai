import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FILE_TOOL_NAMES } from "../files/operations";
import { resolveServerRoot } from "../files/server";
import type { McpServerConfig } from "./types";

export const GITHUB_SERVER_ID = "github";
export const FILES_SERVER_ID = "files";

/** GitHub's hosted MCP server (CL-4). Spike S-6 took this from GitHub's documentation, not a live call. */
export const GITHUB_ENDPOINT = "https://api.githubcopilot.com/mcp/";

/**
 * The read-only tools of the hosted server that the default allow-list loads. The names come from
 * GitHub's documentation (spike S-6); whether each one carries `readOnlyHint: true` is confirmed only
 * in the hands-on run, and a tool without it is not registered (ADR-7).
 */
export const GITHUB_READ_ONLY_TOOLS = Object.freeze([
	"get_file_contents",
	"issue_read",
	"list_issues",
	"pull_request_read",
	"search_issues",
] as const);

/** The input names each override description mentions (documented, not yet confirmed by a live call). */
export const GITHUB_TOOL_INPUTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	get_file_contents: ["owner", "repo", "path", "ref"],
	issue_read: ["method", "owner", "repo", "issue_number"],
	list_issues: ["owner", "repo", "state", "labels", "perPage", "after"],
	pull_request_read: ["method", "owner", "repo", "pullNumber"],
	search_issues: ["query", "owner", "repo", "perPage", "page"],
});

/**
 * Descriptions in the CL-18 form that replace the server's own (CL-25). Each names the tool's
 * documented inputs, so the input-meaning check passes whether or not the server describes them.
 */
const GITHUB_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
	get_file_contents: [
		"GitHub のリポジトリにあるファイルまたはディレクトリの内容を取得する（読み取り専用）。",
		"使うとき: owner と repo で指すリポジトリの path にあるファイルの中身、またはディレクトリの一覧を見たいとき。ref でブランチやタグを指定できる。",
		"使わないとき: ファイルを書き換えたいとき、リポジトリ全体から語句を探したいとき（search_issues などを使う）。",
		"例: owner=octocat, repo=Hello-World, path=README.md",
	].join("\n"),
	issue_read: [
		"GitHub の issue の内容、コメント、ラベルを取得する（読み取り専用）。",
		"使うとき: owner と repo で指すリポジトリの issue_number 番の issue を、method で読み取りの種類を選んで確認したいとき。",
		"使わないとき: issue を作る・更新するとき、条件に合う issue を探すとき（list_issues か search_issues を使う）。",
		"例: method=get, owner=octocat, repo=Hello-World, issue_number=1",
	].join("\n"),
	list_issues: [
		"GitHub のリポジトリの issue を一覧する（読み取り専用）。",
		"使うとき: owner と repo で指すリポジトリの issue を state（open か closed）や labels で絞って、perPage 件ずつ眺めたいとき。続きは after で取得する。",
		"使わないとき: 1 件の issue の詳細が欲しいとき（issue_read を使う）、語句で探すとき（search_issues を使う）。",
		"例: owner=octocat, repo=Hello-World, state=OPEN, perPage=10",
	].join("\n"),
	pull_request_read: [
		"GitHub のプルリクエストの内容、差分、レビューの状況を取得する（読み取り専用）。",
		"使うとき: owner と repo で指すリポジトリの pullNumber 番のプルリクエストを、method で読み取りの種類を選んで確認したいとき。",
		"使わないとき: プルリクエストを作る・マージするとき、プルリクエストを探すとき。",
		"例: method=get, owner=octocat, repo=Hello-World, pullNumber=1",
	].join("\n"),
	search_issues: [
		"GitHub の issue を語句や条件で検索する（読み取り専用）。",
		"使うとき: query に GitHub の検索構文で条件を書いて、issue を横断的に探したいとき。owner と repo で範囲を絞り、perPage と page で件数と位置を決める。",
		"使わないとき: リポジトリの issue を順に眺めたいとき（list_issues を使う）、1 件の詳細が欲しいとき（issue_read を使う）。",
		"例: query=is:open label:bug, owner=octocat, repo=Hello-World",
	].join("\n"),
});

const GITHUB_AUTH_MESSAGE =
	"GitHub が認証を拒否しました。環境変数 GITHUB_TOKEN の値と、読み取り専用の権限を確認してください。";

/**
 * The hosted GitHub server over HTTP with `GITHUB_TOKEN` as a bearer token (Req 1.9). Without a
 * token there is no configuration, and the server is not offered at all. The token appears only in
 * the `Authorization` header: not in the URL, the allow-list, a status or an error message.
 * `X-MCP-Readonly` asks the server itself for its read-only mode; the platform's own allow-list and
 * risk check do not depend on it.
 */
export function githubServerConfig(env: {
	readonly GITHUB_TOKEN?: string | undefined;
}): McpServerConfig | { readonly reason: "token-missing" } {
	const token = env.GITHUB_TOKEN?.trim();
	if (token === undefined || token === "") return { reason: "token-missing" };
	return {
		id: GITHUB_SERVER_ID,
		transport: {
			kind: "http",
			url: GITHUB_ENDPOINT,
			headers: { Authorization: `Bearer ${token}`, "X-MCP-Readonly": "true" },
		},
		allow: GITHUB_READ_ONLY_TOOLS,
		descriptions: GITHUB_DESCRIPTIONS,
		trustErrorMeta: false,
		fatalMessages: { "auth-failed": GITHUB_AUTH_MESSAGE },
	};
}

// Not `new URL("../files/stdio.ts", import.meta.url)`: Turbopack treats that form as a file asset
// reference and fails the build (the same lesson as `DEFAULT_FIXTURE_DIRECTORY` in `mock/fixtures.ts`).
const DEFAULT_SERVER_FILE = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"files",
	"stdio.ts",
);

/**
 * The platform's own file server, started as a child process by the current Node's type stripping
 * (CL-3). Its error metadata is believed (CL-24) because the platform wrote it; the learner's
 * messages are built here from the allowed root.
 */
export function filesServerConfig(options: {
	readonly root: string;
	/** The entry file to start. Defaults to `files/stdio.ts` next to this package's source. */
	readonly serverFile?: string | undefined;
}): McpServerConfig {
	const root = resolve(options.root);
	return {
		id: FILES_SERVER_ID,
		transport: {
			kind: "stdio",
			command: process.execPath,
			args: [options.serverFile ?? DEFAULT_SERVER_FILE],
			env: { MCP_FS_ROOT: root },
		},
		allow: [
			FILE_TOOL_NAMES.list,
			FILE_TOOL_NAMES.read,
			FILE_TOOL_NAMES.search,
			FILE_TOOL_NAMES.findAndRead,
		],
		trustErrorMeta: true,
		preflight: async () => {
			const resolved = await resolveServerRoot(root);
			return resolved.ok ? undefined : resolved.message;
		},
		fatalMessages: {
			"not-allowed": `許可されたルート（${root}）の外のパスにはアクセスできません。`,
			"config-missing": `許可ルート（${root}）が使えません。環境変数 MCP_FS_ROOT を確認してください。`,
		},
	};
}

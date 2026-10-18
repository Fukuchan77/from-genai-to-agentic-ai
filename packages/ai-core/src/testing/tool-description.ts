/**
 * A description that satisfies the CL-18 format, for tests that define throw-away tools:
 * `defineAciTool` rejects any description without the three heading lines.
 */
export function describeTool(summary: string): string {
	return [
		summary,
		"使うとき: テストの中で呼び出すとき。",
		"使わないとき: テスト以外のとき。",
		"例: {}",
	].join("\n");
}

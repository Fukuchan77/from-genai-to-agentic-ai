import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SourceErrorView } from "./SourceErrorView";

afterEach(cleanup);

describe("SourceErrorView", () => {
	it.each([
		["http-status", "記事のサーバーがエラーを返しました。"],
		["empty-body", "ページに要約できる本文がありませんでした。"],
		["network", "ネットワークエラーのため記事を取得できませんでした。"],
		["disallowed-url", "この URL は取得できません。"],
		["timeout", "記事の取得が時間内に終わりませんでした。"],
		["too-large", "記事が大きすぎるため取得できません。"],
		["no-captions", "この動画には利用できる字幕がありません。"],
		["private", "非公開の動画のため字幕を取得できません。"],
		["fetch-failed", "動画の字幕を取得できませんでした。"],
	])("explains the reason %s in Japanese (Req 4.7, 4.11)", (reason, text) => {
		render(<SourceErrorView reason={reason} />);

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain(text);
		expect(alert.textContent).not.toContain(reason);
	});

	it("shows the HTTP status for http-status", () => {
		render(<SourceErrorView reason="http-status" status={404} />);

		expect(screen.getByRole("alert").textContent).toContain("HTTP ステータス 404");
	});

	it("does not show a status for other reasons", () => {
		render(<SourceErrorView reason="network" status={500} />);

		expect(screen.getByRole("alert").textContent).not.toContain("500");
	});

	it("suggests pasting the transcript when a video's captions are unavailable", () => {
		render(<SourceErrorView reason="no-captions" />);

		expect(screen.getByRole("alert").textContent).toContain("字幕テキストを貼り付けて");
	});

	it("falls back to the server message, or a fixed text, for an unknown reason", () => {
		const { rerender } = render(<SourceErrorView reason="brand-new" message="サーバーの説明" />);
		expect(screen.getByRole("alert").textContent).toContain("サーバーの説明");
		expect(screen.getByRole("alert").textContent).not.toContain("brand-new");

		rerender(<SourceErrorView />);
		expect(screen.getByRole("alert").textContent).toContain("ソースを取得できませんでした。");
	});

	it("has a heading that names the problem", () => {
		render(<SourceErrorView reason="private" />);

		expect(screen.getByText("ソースを取得できませんでした")).toBeTruthy();
	});
});

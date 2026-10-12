import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { isToolPart, ToolPartView, toolNameOf } from "./ToolPartView";

afterEach(cleanup);

const WEATHER = {
	city: "Tokyo",
	cityLabel: "東京",
	latitude: 35.7,
	longitude: 139.7,
	temperatureC: 22,
	weatherCode: 0,
	condition: "快晴",
};

describe("ToolPartView", () => {
	it("shows a progress state while the input is streaming, without a result card", () => {
		render(
			<ToolPartView
				part={{
					type: "tool-weather",
					toolCallId: "c1",
					state: "input-streaming",
					input: { ci: 1 },
				}}
			/>,
		);

		expect(screen.getByText("weather")).toBeTruthy();
		expect(screen.getByText("引数を生成しています")).toBeTruthy();
		expect(screen.queryByRole("region", { name: "天気" })).toBeNull();
	});

	it("shows the arguments and a running state once the input is complete", () => {
		const { container } = render(
			<ToolPartView
				part={{
					type: "tool-weather",
					toolCallId: "c1",
					state: "input-available",
					input: { city: "Tokyo" },
				}}
			/>,
		);

		expect(screen.getByText("実行しています")).toBeTruthy();
		expect(container.querySelector("pre")?.textContent).toContain('"city": "Tokyo"');
	});

	it("renders the registered card for a successful result and offers the raw JSON (Req 5.5)", () => {
		const { container } = render(
			<ToolPartView
				part={{
					type: "tool-weather",
					toolCallId: "c1",
					state: "output-available",
					input: { city: "Tokyo" },
					output: { ok: true, data: WEATHER },
				}}
			/>,
		);

		expect(screen.getByText("完了")).toBeTruthy();
		expect(screen.getByRole("region", { name: "天気" })).toBeTruthy();
		expect(screen.getByText("快晴")).toBeTruthy();
		const details = container.querySelector("details");
		expect(details?.querySelector("summary")?.textContent).toBe("生の JSON を表示");
		expect(details?.hasAttribute("open")).toBe(false);
		fireEvent.click(details?.querySelector("summary") as Element);
	});

	it("shows a tool failure's kind, summary and next action instead of a card", () => {
		render(
			<ToolPartView
				part={{
					type: "tool-weather",
					toolCallId: "c1",
					state: "output-available",
					input: {},
					output: {
						ok: false,
						failure: {
							kind: "timeout",
							summary: "時間内に完了しませんでした。",
							nextAction: "もう一度試してください。",
						},
					},
				}}
			/>,
		);

		expect(screen.getByText("時間切れ")).toBeTruthy();
		expect(screen.getByText("時間内に完了しませんでした。")).toBeTruthy();
		expect(screen.getByText("もう一度試してください。")).toBeTruthy();
		expect(screen.queryByRole("region", { name: "天気" })).toBeNull();
	});

	it("shows the message of a stream-error JSON for an output-error part, never raw text", () => {
		render(
			<ToolPartView
				part={{
					type: "tool-weather",
					toolCallId: "c1",
					state: "output-error",
					input: {},
					errorText: JSON.stringify({ code: "provider-unavailable", message: "固定の文言です。" }),
				}}
			/>,
		);
		expect(screen.getByText("固定の文言です。")).toBeTruthy();
		cleanup();

		render(
			<ToolPartView
				part={{
					type: "tool-weather",
					toolCallId: "c1",
					state: "output-error",
					input: {},
					errorText: "Error: secret-token-123",
				}}
			/>,
		);
		expect(screen.queryByText(/secret-token-123/u)).toBeNull();
		expect(screen.getByText(/予期しないエラー/u)).toBeTruthy();
	});

	it("shows raw JSON for a tool without a registered renderer (Req 5.5)", () => {
		const { container } = render(
			<ToolPartView
				part={{
					type: "tool-mystery",
					toolCallId: "c1",
					state: "output-available",
					input: { q: 1 },
					output: { ok: true, data: { answer: 42 } },
				}}
			/>,
		);

		expect(screen.getByText("mystery")).toBeTruthy();
		const texts = [...container.querySelectorAll("pre")].map((pre) => pre.textContent);
		expect(texts.some((text) => text?.includes('"answer": 42'))).toBe(true);
		expect(container.querySelector("details")).toBeNull();
	});

	it("reads the name of a dynamic tool part from toolName", () => {
		render(
			<ToolPartView
				part={{
					type: "dynamic-tool",
					toolName: "remote",
					toolCallId: "c1",
					state: "input-available",
					input: {},
				}}
			/>,
		);

		expect(screen.getByText("remote")).toBeTruthy();
	});

	it("does not treat a registered name that merely resembles an object key as a renderer", () => {
		const { container } = render(
			<ToolPartView
				part={{
					type: "tool-constructor",
					toolCallId: "c1",
					state: "output-available",
					input: {},
					output: { ok: true, data: { x: 1 } },
				}}
			/>,
		);

		const texts = [...container.querySelectorAll("pre")].map((pre) => pre.textContent);
		expect(texts.some((text) => text?.includes('"x": 1'))).toBe(true);
	});
});

describe("isToolPart / toolNameOf", () => {
	it("recognises static and dynamic tool parts only", () => {
		expect(isToolPart({ type: "tool-weather" })).toBe(true);
		expect(isToolPart({ type: "dynamic-tool" })).toBe(true);
		expect(isToolPart({ type: "text" })).toBe(false);
		expect(isToolPart({ type: "step-start" })).toBe(false);
		expect(toolNameOf({ type: "tool-calculator" })).toBe("calculator");
	});
});

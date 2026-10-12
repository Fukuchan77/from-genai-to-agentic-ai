import type { ResponseMetadata } from "@platform/ai-core/chat";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MessageMeta } from "./MessageMeta";

afterEach(cleanup);

const base: ResponseMetadata = {
	modelId: "mock:general-v1",
	modelName: "Deterministic Mock Model",
	provider: "mock",
	personaId: "general-assistant",
	personaVersion: "1.0.0",
	disabledTools: [],
};

describe("MessageMeta", () => {
	it("shows the model name and input / output token counts (Req 3.7)", () => {
		render(<MessageMeta metadata={{ ...base, usage: { inputTokens: 1234, outputTokens: 56 } }} />);

		expect(screen.getByText("Deterministic Mock Model")).toBeTruthy();
		expect(screen.getByText("入力 1,234 トークン")).toBeTruthy();
		expect(screen.getByText("出力 56 トークン")).toBeTruthy();
		expect(screen.queryByText(/キャッシュ/u)).toBeNull();
	});

	it("shows the cache-read amount only when the provider reported it", () => {
		render(
			<MessageMeta
				metadata={{ ...base, usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 7 } }}
			/>,
		);

		expect(screen.getByText("キャッシュ読み出し 7 トークン")).toBeTruthy();
	});

	it("shows only the model name until usage arrives with the finish chunk", () => {
		render(<MessageMeta metadata={base} />);

		expect(screen.getByText("Deterministic Mock Model")).toBeTruthy();
		expect(screen.queryByText(/トークン/u)).toBeNull();
	});

	it("renders nothing without metadata (a stopped or failed answer)", () => {
		const { container } = render(<MessageMeta metadata={undefined} />);

		expect(container.textContent).toBe("");
	});

	it("labels the group for assistive technology", () => {
		render(<MessageMeta metadata={base} />);

		expect(screen.getByRole("list", { name: "応答の情報" })).toBeTruthy();
	});
});

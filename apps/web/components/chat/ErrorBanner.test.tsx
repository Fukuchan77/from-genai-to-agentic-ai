import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toStreamErrorText } from "@/lib/server/errors";
import { ErrorBanner, toDisplayError } from "./ErrorBanner";

afterEach(cleanup);

describe("toDisplayError", () => {
	it("reads the code and message of a stream error text", () => {
		const text = toStreamErrorText({ code: "x" });
		expect(toDisplayError(new Error(text)).code).toBe("unexpected");

		const stream = JSON.stringify({ code: "provider-unavailable", message: "つながりません。" });
		expect(toDisplayError(new Error(stream))).toEqual({
			code: "provider-unavailable",
			message: "つながりません。",
		});
	});

	it("reads the JSON error body of a rejected HTTP request", () => {
		const body = JSON.stringify({ error: { code: "rate-limited", message: "回数の上限です。" } });

		expect(toDisplayError(new Error(body))).toEqual({
			code: "rate-limited",
			message: "回数の上限です。",
		});
	});

	it("never shows raw error text it cannot parse", () => {
		const shown = toDisplayError(new Error("TypeError: secret stack at /srv/app.js:1"));

		expect(shown.code).toBe("unexpected");
		expect(shown.message).not.toContain("secret");
	});
});

describe("ErrorBanner", () => {
	const error = new Error(
		JSON.stringify({ code: "provider-unavailable", message: "モデルに接続できません。" }),
	);

	it("announces the error as an alert with its message (Req 3.6)", () => {
		render(<ErrorBanner error={error} onRetry={() => {}} />);

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("モデルに接続できません。");
	});

	it("offers a retry button that calls onRetry (Req 3.6)", () => {
		const onRetry = vi.fn();
		render(<ErrorBanner error={error} onRetry={onRetry} />);

		fireEvent.click(screen.getByRole("button", { name: "再送信" }));

		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("can be dismissed when a handler is given", () => {
		const onDismiss = vi.fn();
		render(<ErrorBanner error={error} onRetry={() => {}} onDismiss={onDismiss} />);

		fireEvent.click(screen.getByRole("button", { name: "閉じる" }));

		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("has no dismiss button without a handler", () => {
		render(<ErrorBanner error={error} onRetry={() => {}} />);

		expect(screen.queryByRole("button", { name: "閉じる" })).toBeNull();
	});
});

import { councilRequestSchema } from "@platform/ai-core/marketing";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CouncilPanel, type CouncilPanelProps, prepareCouncilRequest } from "./CouncilPanel";

const chat = vi.hoisted(() => ({
	state: {
		messages: [] as unknown[],
		status: "ready" as string,
		error: undefined as Error | undefined,
	},
	sendMessage: vi.fn(async () => {}),
	stop: vi.fn(async () => {}),
	setMessages: vi.fn(),
	clearError: vi.fn(),
}));

vi.mock("@ai-sdk/react", () => ({
	useChat: () => ({
		...chat.state,
		sendMessage: chat.sendMessage,
		stop: chat.stop,
		setMessages: chat.setMessages,
		clearError: chat.clearError,
	}),
}));

beforeEach(() => {
	chat.state.messages = [];
	chat.state.status = "ready";
	chat.state.error = undefined;
	for (const fn of [chat.sendMessage, chat.stop, chat.setMessages, chat.clearError]) fn.mockClear();
});
afterEach(cleanup);

const PERSONAS = [
	{ id: "marketer-strict", name: "厳しいマーケター", viewpoint: "成果の根拠を求める" },
	{ id: "consumer", name: "一般の消費者", viewpoint: "分かりやすさを重視する" },
	{ id: "seo-specialist", name: "SEO の専門家", viewpoint: "検索での見つけやすさを見る" },
	{ id: "legal", name: "法務担当", viewpoint: "表現のリスクを確認する" },
	{ id: "designer", name: "デザイナー", viewpoint: "見た目の印象を見る" },
	{ id: "sales", name: "営業担当", viewpoint: "顧客への伝わり方を見る" },
];

const DEFAULTS: CouncilPanelProps = {
	personas: PERSONAS,
	defaultPersonaIds: ["marketer-strict", "consumer", "seo-specialist"],
	draftMaxLength: 2000,
	personaLimits: { min: 2, max: 5 },
	roundLimits: { min: 1, max: 6, default: 3 },
};

function renderPanel(over: Partial<CouncilPanelProps> = {}) {
	return render(<CouncilPanel {...DEFAULTS} {...over} />);
}

const draftField = () => screen.getByLabelText("広告文案") as HTMLTextAreaElement;
const submit = () => screen.getByRole("button", { name: "合議を始める" }) as HTMLButtonElement;
const persona = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
const roundsField = () => screen.getByLabelText("ラウンドの上限") as HTMLInputElement;

function write(text: string) {
	fireEvent.change(draftField(), { target: { value: text } });
}

describe("draft input", () => {
	it("starts disabled and enables for a non-blank draft", () => {
		renderPanel();
		expect(submit().disabled).toBe(true);
		write("   ");
		expect(submit().disabled).toBe(true);
		write("新発売のコーヒー");
		expect(submit().disabled).toBe(false);
	});

	it("accepts exactly 2000 characters and refuses 2001", () => {
		renderPanel();
		write("あ".repeat(2000));
		expect(submit().disabled).toBe(false);
		expect(screen.getByText("2000 / 2000 文字")).not.toBeNull();
		write("あ".repeat(2001));
		expect(submit().disabled).toBe(true);
		expect(screen.getByRole("alert").textContent).toContain(
			"文案は 2000 文字までです（現在 2001 文字）。",
		);
		expect(draftField().getAttribute("aria-invalid")).toBe("true");
	});

	it("counts characters, not UTF-16 units", () => {
		renderPanel();
		write("😀".repeat(2000));
		expect(submit().disabled).toBe(false);
	});
});

describe("persona selection", () => {
	it("gives every persona checkbox a visible focus ring of at least 2px", () => {
		renderPanel();
		const group = screen.getByRole("group", { name: "参加するペルソナ" });
		for (const checkbox of within(group).getAllByRole("checkbox")) {
			expect(checkbox.className).toContain("focus-visible:outline-2");
		}
	});

	it("lists every persona with its viewpoint and checks the defaults", () => {
		renderPanel();
		const group = screen.getByRole("group", { name: "参加するペルソナ" });
		expect(within(group).getAllByRole("checkbox")).toHaveLength(6);
		expect(persona("厳しいマーケター").checked).toBe(true);
		expect(persona("法務担当").checked).toBe(false);
		expect(screen.getByText("表現のリスクを確認する")).not.toBeNull();
		expect(screen.getByText("3 / 5 件を選択中（2〜5 件）")).not.toBeNull();
	});

	it("blocks sending with fewer than 2 personas", () => {
		renderPanel();
		write("文案");
		fireEvent.click(persona("一般の消費者"));
		expect(submit().disabled).toBe(false);
		fireEvent.click(persona("SEO の専門家"));
		expect(submit().disabled).toBe(true);
		expect(screen.getByRole("alert").textContent).toContain("ペルソナは 2〜5 件を選んでください");
	});

	it("stops offering more at 5 and frees them when one is removed", () => {
		renderPanel();
		fireEvent.click(persona("法務担当"));
		fireEvent.click(persona("デザイナー"));
		expect(screen.getByText("5 / 5 件を選択中（2〜5 件）")).not.toBeNull();
		expect(persona("営業担当").disabled).toBe(true);
		expect(persona("法務担当").disabled).toBe(false);
		fireEvent.click(persona("法務担当"));
		expect(persona("営業担当").disabled).toBe(false);
	});
});

describe("round limit", () => {
	it("starts at the default and refuses values outside the range", () => {
		renderPanel();
		write("文案");
		expect(roundsField().value).toBe("3");
		for (const bad of ["0", "7", "", "2.5"]) {
			fireEvent.change(roundsField(), { target: { value: bad } });
			expect(submit().disabled).toBe(true);
		}
		for (const good of ["1", "6"]) {
			fireEvent.change(roundsField(), { target: { value: good } });
			expect(submit().disabled).toBe(false);
		}
	});
});

describe("sending", () => {
	it("sends the draft, the selected personas in catalog order and the round limit", () => {
		renderPanel();
		write("  新発売のコーヒー  ");
		fireEvent.click(persona("法務担当"));
		fireEvent.change(roundsField(), { target: { value: "2" } });
		fireEvent.click(submit());
		expect(chat.setMessages).toHaveBeenCalledWith([]);
		expect(chat.sendMessage).toHaveBeenCalledTimes(1);
		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "新発売のコーヒー" },
			{
				body: {
					draft: "新発売のコーヒー",
					personaIds: ["marketer-strict", "consumer", "seo-specialist", "legal"],
					maxRounds: 2,
				},
			},
		);
	});

	it("builds a council body the server schema accepts, without the chat messages", () => {
		const prepared = prepareCouncilRequest({
			id: "c1",
			messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "x" }] }],
			body: { draft: "文案", personaIds: ["consumer", "legal"], maxRounds: 3 },
		});
		expect(prepared.api).toBe("/api/marketing/council");
		expect(prepared.body).toEqual({
			draft: "文案",
			personaIds: ["consumer", "legal"],
			maxRounds: 3,
		});
		expect(councilRequestSchema.safeParse(prepared.body).success).toBe(true);
	});

	it("shows stop while running and disables the form controls", () => {
		chat.state.status = "streaming";
		renderPanel();
		write("文案");
		expect(submit().disabled).toBe(true);
		expect(persona("法務担当").disabled).toBe(true);
		expect(draftField().disabled).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "停止" }));
		expect(chat.stop).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("status", { name: "実行の状態" }).textContent).toContain(
			"合議を進めています",
		);
	});
});

function turn(n: number, round: number, name: string, text: string) {
	return {
		type: "data-council-turn",
		id: `turn-${n}`,
		data: { round, personaId: `p-${n}`, personaName: name, text, failed: false },
	};
}

function verdictPart(round: number, agreed: boolean) {
	return {
		type: "data-council-verdict",
		id: `verdict-${round}`,
		data: { round, agreed, reason: `ラウンド${round}の判定`, remainingObjections: [] },
	};
}

function assistant(parts: unknown[]) {
	return [
		{ id: "u", role: "user", parts: [{ type: "text", text: "文案" }] },
		{ id: "a", role: "assistant", parts },
	];
}

describe("timeline", () => {
	it("shows statements under persona names, verdicts and the result", () => {
		chat.state.messages = assistant([
			turn(1, 1, "厳しいマーケター", "根拠が弱いです"),
			verdictPart(1, false),
			turn(2, 2, "一般の消費者", "分かりやすくなりました"),
			verdictPart(2, true),
			{
				type: "data-council-result",
				id: "result",
				data: {
					improvedDraft: "改善後のコーヒー文案",
					endReason: "agreed",
					rounds: [
						{ round: 1, statements: 1, missing: [] },
						{ round: 2, statements: 1, missing: [] },
					],
				},
			},
		]);
		renderPanel();
		const log = within(screen.getByRole("log", { name: "合議の経過" }));
		expect(log.getByRole("heading", { name: "厳しいマーケター", level: 4 })).not.toBeNull();
		expect(screen.getByText("根拠が弱いです")).not.toBeNull();
		expect(screen.getByText("改善後のコーヒー文案")).not.toBeNull();
		expect(screen.getByText("合意に達したため終了しました")).not.toBeNull();
		expect(screen.getByRole("log", { name: "合議の経過" })).not.toBeNull();
	});

	it("shows no timeline before anything arrived", () => {
		renderPanel();
		expect(screen.queryByRole("log", { name: "合議の経過" })).toBeNull();
	});
});

describe("stream failure (W6 review F-17)", () => {
	const failure = new Error(
		JSON.stringify({ error: { code: "unexpected", message: "合議が中断されました" } }),
	);

	it("drops the statements of a round that was never confirmed and keeps the settled ones", () => {
		chat.state.messages = assistant([
			turn(1, 1, "厳しいマーケター", "確定したラウンドの発言"),
			verdictPart(1, false),
			turn(2, 2, "一般の消費者", "確定していないラウンドの発言"),
		]);
		chat.state.error = failure;
		renderPanel();
		expect(screen.getByText("確定したラウンドの発言")).not.toBeNull();
		expect(screen.queryByText("確定していないラウンドの発言")).toBeNull();
		expect(screen.getByText("合議が中断されました")).not.toBeNull();
	});

	it("keeps every statement while the stream is healthy", () => {
		chat.state.status = "streaming";
		chat.state.messages = assistant([
			turn(1, 1, "厳しいマーケター", "確定したラウンドの発言"),
			verdictPart(1, false),
			turn(2, 2, "一般の消費者", "進行中のラウンドの発言"),
		]);
		renderPanel();
		expect(screen.getByText("進行中のラウンドの発言")).not.toBeNull();
	});

	it("keeps the unconfirmed round hidden after the error banner is dismissed (review F-3)", () => {
		chat.state.messages = assistant([
			turn(1, 1, "厳しいマーケター", "確定したラウンドの発言"),
			verdictPart(1, false),
			turn(2, 2, "一般の消費者", "確定していないラウンドの発言"),
		]);
		chat.state.error = failure;
		chat.state.status = "error";
		const view = renderPanel();
		// The real clearError drops the error and returns the status to ready.
		chat.state.error = undefined;
		chat.state.status = "ready";
		view.rerender(<CouncilPanel {...DEFAULTS} />);
		expect(screen.getByText("確定したラウンドの発言")).not.toBeNull();
		expect(screen.queryByText("確定していないラウンドの発言")).toBeNull();
	});

	it("says the run was stopped and hides the unconfirmed round after stop (review F-3)", () => {
		chat.state.status = "ready";
		chat.state.messages = assistant([
			turn(1, 1, "厳しいマーケター", "確定したラウンドの発言"),
			verdictPart(1, false),
			turn(2, 2, "一般の消費者", "停止時に未確定だった発言"),
		]);
		renderPanel();
		expect(screen.getByRole("status", { name: "実行の状態" }).textContent).toContain(
			"生成を停止しました",
		);
		expect(screen.getByText("確定したラウンドの発言")).not.toBeNull();
		expect(screen.queryByText("停止時に未確定だった発言")).toBeNull();
	});

	it("shows everything and no stopped message after a finished run (review F-3)", () => {
		chat.state.status = "ready";
		chat.state.messages = assistant([
			turn(1, 1, "厳しいマーケター", "最終ラウンドの発言"),
			{
				type: "data-council-result",
				id: "result",
				data: {
					improvedDraft: "改善後",
					endReason: "max-rounds",
					rounds: [{ round: 1, statements: 1, missing: [] }],
				},
			},
		]);
		renderPanel();
		expect(screen.getByText("最終ラウンドの発言")).not.toBeNull();
		expect(screen.getByRole("status", { name: "実行の状態" }).textContent).not.toContain("停止");
	});

	it("retries with the draft that was sent", () => {
		const view = renderPanel();
		write("文案その2");
		fireEvent.click(submit());
		chat.state.error = failure;
		view.rerender(<CouncilPanel {...DEFAULTS} />);
		chat.sendMessage.mockClear();
		fireEvent.click(screen.getByRole("button", { name: "再送信" }));
		expect(chat.clearError).toHaveBeenCalled();
		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "文案その2" },
			{ body: { draft: "文案その2", personaIds: DEFAULTS.defaultPersonaIds, maxRounds: 3 } },
		);
	});
});

describe("unseeded catalog", () => {
	it("shows the seed:samples guidance", () => {
		chat.state.error = new Error(
			JSON.stringify({
				error: {
					code: "provider-unavailable",
					message:
						"商品カタログとペルソナが未投入です。`mise run seed:samples` を実行してください。",
				},
			}),
		);
		renderPanel();
		expect(screen.getByRole("alert").textContent).toContain("サンプルデータが投入されていません");
		expect(screen.getByText("mise run seed:samples")).not.toBeNull();
	});
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { M3_6_SAMPLE_DRAFTS, M3_6_SAMPLE_MESSAGES, M3_SCENARIOS } from "../mock";
import { createScenarioModel } from "../mock/scenario-model";
import { createFakeClock } from "../ports/clock";
import { createPgliteDatabase, type RagDatabaseHandle } from "../rag/db";
import { createCatalogRepo } from "./catalog";
import { runCouncil } from "./council";
import { EMPTY_PROFILE, extractProfile } from "./profile";
import { overBudgetNote, recommend } from "./recommend";
import { loadSamplePersonas, seedMarketing } from "./seed";

// The m3-6 scenarios, end to end: the real council, moderator, profile and recommend code against
// the scenario model, with the committed catalog in an in-memory PGlite.

const model = () => createScenarioModel({ purpose: "chat", scenarios: M3_SCENARIOS });

let handle: RagDatabaseHandle;

beforeAll(async () => {
	handle = await createPgliteDatabase();
	await seedMarketing({ db: handle.db, reset: true });
});

afterAll(async () => {
	await handle.close();
});

async function council(draft: string) {
	return runCouncil({
		draft,
		personas: await loadSamplePersonas(),
		model: model(),
		clock: createFakeClock(),
		signal: new AbortController().signal,
	});
}

describe("m3-6 council scenarios", () => {
	it("default: an objection remains after round 1, everyone agrees in round 2", async () => {
		const result = await council(M3_6_SAMPLE_DRAFTS.default);
		expect(result.endReason).toBe("agreed");
		expect(result.rounds).toHaveLength(2);
		expect(result.rounds[0]?.verdict).toMatchObject({ agreed: false });
		expect(result.rounds[0]?.verdict?.remainingObjections.length).toBeGreaterThan(0);
		expect(result.rounds[1]?.verdict).toMatchObject({ agreed: true, remainingObjections: [] });
		for (const round of result.rounds) {
			expect(round.statements.map((statement) => statement.personaId)).toEqual([
				"marketer-strict",
				"consumer",
				"seo-specialist",
			]);
			expect(round.missing).toEqual([]);
		}
	});

	it("default: the improved draft is the last persona's draft of the last round", async () => {
		const result = await council(M3_6_SAMPLE_DRAFTS.default);
		expect(result.improvedDraft).not.toBe(M3_6_SAMPLE_DRAFTS.default);
		expect(result.improvedDraft).not.toContain("<draft>");
		expect(result.rounds[0]?.draft).not.toBe(result.rounds[1]?.draft);
		expect(result.improvedDraft).toBe(result.rounds[1]?.draft);
	});

	it("default: tokens are counted for each persona and the moderator", async () => {
		const result = await council(M3_6_SAMPLE_DRAFTS.default);
		expect(Object.keys(result.usage.byRole).sort()).toEqual([
			"consumer",
			"marketer-strict",
			"moderator",
			"seo-specialist",
		]);
		expect(result.usage.byRole.moderator).toMatchObject({ calls: 2 });
	});

	it("objections: the moderator says agreed with an open objection, which is not an agreement (CL-12)", async () => {
		const result = await council(M3_6_SAMPLE_DRAFTS.objections);
		expect(result.rounds).toHaveLength(2);
		expect(result.rounds[0]?.verdict?.agreed).toBe(false);
		expect(result.rounds[0]?.verdict?.remainingObjections).toHaveLength(1);
		expect(result.rounds[1]?.verdict?.agreed).toBe(true);
		expect(result.endReason).toBe("agreed");
	});

	it("does not answer a draft it has no scenario for: a mock run never invents a result", async () => {
		await expect(council("このコピーには台本がありません")).rejects.toThrow();
	});
});

describe("m3-6 profile and recommend scenarios", () => {
	it("extracts interests, budget and concerns from the first message", async () => {
		const profile = await extractProfile({
			model: model(),
			previous: EMPTY_PROFILE,
			messages: [{ role: "user", content: M3_6_SAMPLE_MESSAGES.first }],
		});
		expect(profile.interests.length).toBeGreaterThan(0);
		expect(profile.budgetYen).toBe(10_000);
	});

	it("merges the second message into the first profile: the budget is overwritten, lists grow", async () => {
		const first = await extractProfile({
			model: model(),
			previous: EMPTY_PROFILE,
			messages: [{ role: "user", content: M3_6_SAMPLE_MESSAGES.first }],
		});
		const second = await extractProfile({
			model: model(),
			previous: first,
			messages: [
				{ role: "user", content: M3_6_SAMPLE_MESSAGES.first },
				{ role: "assistant", content: "どのような点が気になりますか。" },
				{ role: "user", content: M3_6_SAMPLE_MESSAGES.second },
			],
		});
		expect(second.budgetYen).toBe(5_000);
		expect(second.interests.length).toBeGreaterThan(first.interests.length);
		expect(second.concerns.length).toBeGreaterThan(0);
	});

	it("drops the product id that the catalog does not have and flags the over-budget one", async () => {
		const profile = await extractProfile({
			model: model(),
			previous: EMPTY_PROFILE,
			messages: [{ role: "user", content: M3_6_SAMPLE_MESSAGES.first }],
		});
		const result = await recommend({
			model: model(),
			profile,
			catalog: createCatalogRepo(handle.db),
			message: M3_6_SAMPLE_MESSAGES.first,
		});
		expect(result.dropped).toBe(1);
		expect(result.items.map((item) => item.productId)).not.toContain("P-999");
		expect(result.items.length).toBeGreaterThan(0);
		const over = result.items.filter((item) => item.overBudget);
		expect(over.length).toBeGreaterThan(0);
		for (const item of over) expect(item.reason).toContain(overBudgetNote(10_000));
	});

	it("recommends only catalog products for the second message", async () => {
		const result = await recommend({
			model: model(),
			profile: { interests: ["ノイズ"], budgetYen: 5_000, concerns: [] },
			catalog: createCatalogRepo(handle.db),
			message: M3_6_SAMPLE_MESSAGES.second,
		});
		expect(result.dropped).toBe(0);
		expect(result.items.length).toBeGreaterThan(0);
		expect(result.items.every((item) => !item.overBudget)).toBe(true);
	});

	it("does not answer a message it has no scenario for", async () => {
		await expect(
			recommend({
				model: model(),
				profile: EMPTY_PROFILE,
				catalog: createCatalogRepo(handle.db),
				message: "この質問には台本がありません",
			}),
		).rejects.toThrow();
	});
});

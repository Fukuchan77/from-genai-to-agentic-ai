import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDeterministicEmbeddingModel } from "../mock/deterministic-embedding";
import { getModelEntry, type ResolvedEmbeddingModel } from "../models";
import { createFakeClock } from "../ports/clock";
import {
	createPgliteDatabase,
	helpdeskPlanRevisions,
	helpdeskTickets,
	type RagDatabaseHandle,
	ragChunks,
	ragDocuments,
} from "../rag/db";
import { ingestDocuments } from "../rag/ingest";
import { detectCredentialShapes } from "./credentials";
import { PlanSchema, validatePlan } from "./plan-schema";
import { FAQ_DIRECTORY, loadSampleTickets, seedHelpdesk } from "./seed";
import { createTicketStore } from "./ticket-store";

const EMBEDDING: ResolvedEmbeddingModel = {
	model: createDeterministicEmbeddingModel({ dimensions: 768 }),
	entry: getModelEntry("mock:embedding-v1"),
	mode: "mock",
};

let handle: RagDatabaseHandle;
let workDir: string;

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	await handle.db.execute(sql`TRUNCATE rag_chunks, rag_documents, rag_meta CASCADE`);
	await handle.db.execute(sql`TRUNCATE helpdesk_plan_revisions, helpdesk_tickets CASCADE`);
	workDir = await mkdtemp(path.join(tmpdir(), "helpdesk-seed-"));
	return async () => {
		await rm(workDir, { recursive: true, force: true });
	};
});

async function counts() {
	return {
		documents: await handle.db.$count(ragDocuments),
		chunks: await handle.db.$count(ragChunks),
		tickets: await handle.db.$count(helpdeskTickets),
		revisions: await handle.db.$count(helpdeskPlanRevisions),
	};
}

const seed = (overrides: Partial<Parameters<typeof seedHelpdesk>[0]> = {}) =>
	seedHelpdesk({ db: handle.db, knowledge: { embedding: EMBEDDING }, ...overrides });

describe("the committed fixtures", () => {
	it("has FAQ documents in Japanese with a heading structure", async () => {
		const files = (await readdir(FAQ_DIRECTORY)).filter((name) => name.endsWith(".md"));

		expect(files.length).toBeGreaterThanOrEqual(5);
		for (const file of files) {
			const text = await readFile(path.join(FAQ_DIRECTORY, file), "utf8");
			expect(text, file).toMatch(/^# \S/m);
			expect((text.match(/^## \S/gm) ?? []).length, file).toBeGreaterThanOrEqual(2);
			expect(text, file).toMatch(/[ぁ-んァ-ン一-龥]/);
			// A FAQ must never teach the agent to answer with a credential.
			expect(detectCredentialShapes(text), file).toEqual([]);
		}
	});

	it("has sample tickets that are consistent, unique and free of credential shapes", async () => {
		const tickets = await loadSampleTickets();

		expect(tickets.length).toBeGreaterThanOrEqual(4);
		expect(new Set(tickets.map((ticket) => ticket.id)).size).toBe(tickets.length);
		expect(new Set(tickets.map((ticket) => ticket.status))).toEqual(
			new Set(["open", "resolved", "escalated"]),
		);
		for (const ticket of tickets) {
			expect(ticket.id).toMatch(/^T-\d{4}$/);
			expect(validatePlan(PlanSchema.parse(ticket.plan)), ticket.id).toEqual([]);
			expect(
				detectCredentialShapes(`${ticket.inquiry}\n${ticket.answer ?? ""}`),
				ticket.id,
			).toEqual([]);
			if (ticket.status === "resolved") expect(ticket.answer, ticket.id).toBeTruthy();
			if (ticket.status === "escalated") expect(ticket.escalationReason, ticket.id).toBeTruthy();
		}
	});
});

describe("seedHelpdesk", () => {
	it("ingests the FAQ through the M2 ingestion and stores the sample tickets with their plans", async () => {
		const result = await seed();

		const faqFiles = (await readdir(FAQ_DIRECTORY)).filter((name) => name.endsWith(".md"));
		expect(result.faq.ingested.map((doc) => doc.documentId).sort()).toEqual(
			faqFiles.map((file) => `kb:${file}`).sort(),
		);
		expect(result.faq.skipped).toEqual([]);
		const samples = await loadSampleTickets();
		expect(result.tickets).toEqual({ inserted: samples.length, existing: 0 });
		expect(await counts()).toMatchObject({
			documents: faqFiles.length,
			tickets: samples.length,
			revisions: samples.length,
		});
		const store = createTicketStore(handle.db);
		const first = samples[0];
		expect(await store.get(first?.id ?? "")).toMatchObject({ status: first?.status });
		expect((await store.revisions(first?.id ?? ""))[0]?.plan).toEqual(first?.plan);
	});

	it("gives the FAQ chunks their heading paths so a citation can name the section", async () => {
		await seed();

		const rows = await handle.db
			.select({ headingPath: ragChunks.headingPath })
			.from(ragChunks)
			.where(sql`document_id = 'kb:vpn-connection.md'`);

		expect(rows.some((row) => row.headingPath.includes("接続できないとき"))).toBe(true);
	});

	it("is idempotent: a second run adds no row", async () => {
		await seed();
		const before = await counts();

		const second = await seed();

		expect(await counts()).toEqual(before);
		expect(second.tickets).toEqual({ inserted: 0, existing: before.tickets });
	});

	it("keeps a ticket the learner changed and the tickets the learner added", async () => {
		await seed();
		const store = createTicketStore(handle.db, {
			clock: createFakeClock(Date.parse("2026-10-18T00:00:00Z")),
		});
		const mine = await store.create({ inquiry: "学習者のチケット" });
		await handle.db.execute(
			sql`UPDATE helpdesk_tickets SET inquiry = '変更済み' WHERE id = 'T-0001'`,
		);

		await seed();

		expect((await store.get(mine.id))?.inquiry).toBe("学習者のチケット");
		expect((await store.get("T-0001"))?.inquiry).toBe("変更済み");
	});

	it("numbers the next learner ticket after the samples", async () => {
		await seed();
		const samples = await loadSampleTickets();

		const next = await createTicketStore(handle.db).create({ inquiry: "新規" });

		expect(next.id).toBe(`T-${String(samples.length + 1).padStart(4, "0")}`);
	});

	describe("reset", () => {
		it("empties the help-desk tables only, then seeds them again, and leaves the rag_* documents alone", async () => {
			await seed();
			await createTicketStore(handle.db).create({
				inquiry: "学習者のチケット",
				initialPlan: { tasks: [] },
			});
			await writeFile(path.join(workDir, "mine.md"), "# 自分の文書\n\n本文です。\n");
			await ingestDocuments({
				db: handle.db,
				embedding: EMBEDDING,
				source: "knowledge",
				root: workDir,
				files: ["mine.md"],
			});
			const samples = await loadSampleTickets();

			const result = await seed({ reset: true });

			expect(result.tickets).toEqual({ inserted: samples.length, existing: 0 });
			const store = createTicketStore(handle.db);
			expect((await store.list({ limit: 50 })).length).toBe(samples.length);
			const documents = await handle.db.select({ id: ragDocuments.id }).from(ragDocuments);
			expect(documents.map((doc) => doc.id)).toContain("kb:mine.md");
		});

		it("does not empty anything without the reset argument", async () => {
			await seed();
			const created = await createTicketStore(handle.db).create({ inquiry: "学習者のチケット" });

			await seed();

			expect(await createTicketStore(handle.db).get(created.id)).toBeDefined();
		});
	});

	describe("a FAQ file that cannot be ingested", () => {
		it("is reported as skipped, like the M2 ingestion does, and the rest is still seeded", async () => {
			await writeFile(path.join(workDir, "good.md"), "# 良い FAQ\n\n## 手順\n\n本文です。\n");
			await writeFile(path.join(workDir, "empty.md"), "");

			const result = await seed({ knowledge: { embedding: EMBEDDING, root: workDir } });

			expect(result.faq.ingested.map((doc) => doc.documentId)).toEqual(["kb:good.md"]);
			expect(result.faq.skipped).toEqual([{ file: "empty.md", reason: expect.any(String) }]);
			expect((await counts()).tickets).toBeGreaterThan(0);
		});

		it("seeds the tickets even when the FAQ directory is missing", async () => {
			const result = await seed({
				knowledge: { embedding: EMBEDDING, root: path.join(workDir, "none") },
			});

			expect(result.faq).toEqual({ ingested: [], skipped: [] });
			expect((await counts()).tickets).toBeGreaterThan(0);
		});
	});

	it("starts nothing when already aborted", async () => {
		const controller = new AbortController();
		controller.abort(new DOMException("Stopped", "AbortError"));

		await expect(seed({ signal: controller.signal })).rejects.toThrow();

		expect(await counts()).toEqual({ documents: 0, chunks: 0, tickets: 0, revisions: 0 });
	});

	it("finds its FAQ directory next to the package fixtures", () => {
		expect(path.isAbsolute(FAQ_DIRECTORY)).toBe(true);
		expect(FAQ_DIRECTORY.endsWith(path.join("fixtures", "helpdesk", "faq"))).toBe(true);
		expect(fileURLToPath(import.meta.url).includes("helpdesk")).toBe(true);
	});
});

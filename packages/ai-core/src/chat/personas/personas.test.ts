import { describe, expect, it } from "vitest";
import { PlatformError } from "../../errors";
import { generalAssistant } from "./general-assistant";
import {
	DEFAULT_PERSONA_ID,
	getPersona,
	isPersonaId,
	PERSONA_IDS,
	PERSONAS,
	type PersonaTemplate,
} from "./index";
import { pythonMentor } from "./python-mentor";
import { strictReviewer } from "./strict-reviewer";

// Semantic Versioning 2.0.0 (https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string)
const SEMVER =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const JAPANESE = /[぀-ヿ一-鿿]/;

describe("PERSONAS", () => {
	it("starts with the three M1 personas in display order", () => {
		expect(PERSONAS.map((persona) => persona.id)).toEqual([
			"general-assistant",
			"python-mentor",
			"strict-reviewer",
		]);
		expect(PERSONAS.map(({ id, version, title }) => ({ id, version, title }))).toEqual(
			[generalAssistant, pythonMentor, strictReviewer].map(({ id, version, title }) => ({
				id,
				version,
				title,
			})),
		);
		expect(PERSONA_IDS).toEqual(PERSONAS.map((persona) => persona.id));
	});

	it("has unique ids", () => {
		const ids = PERSONAS.map((persona) => persona.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("uses kebab-case ids", () => {
		for (const persona of PERSONAS) {
			expect(persona.id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
		}
	});

	it.each(PERSONAS.map((persona) => [persona.id, persona] as const))(
		"%s has a semver version and a Japanese title",
		(_id, persona) => {
			expect(persona.version).toMatch(SEMVER);
			expect(persona.title.trim()).not.toBe("");
			expect(persona.title).toMatch(JAPANESE);
		},
	);

	it("rejects non-semver strings with the same pattern the personas are checked against", () => {
		for (const invalid of ["1", "1.0", "v1.0.0", "01.0.0", "1.0.0.0", "1.0.0-"]) {
			expect(invalid).not.toMatch(SEMVER);
		}
		expect("1.2.3-beta.1+build.5").toMatch(SEMVER);
	});

	it("is frozen so a request cannot rewrite a shared template", () => {
		expect(Object.isFrozen(PERSONAS)).toBe(true);
		for (const persona of PERSONAS) {
			expect(Object.isFrozen(persona)).toBe(true);
		}
	});
});

describe("PersonaTemplate.render", () => {
	it.each(PERSONAS.map((persona) => [persona.id, persona] as const))(
		"%s renders a deterministic Japanese prompt without vars",
		(_id, persona) => {
			const prompt = persona.render({});
			expect(prompt).toBe(persona.render({}));
			expect(prompt.trim()).not.toBe("");
			expect(prompt).toMatch(JAPANESE);
			expect(prompt).not.toMatch(/\{\{|\}\}|undefined|null/);
			expect(prompt).not.toMatch(/モデル名:|今日の日付:/);
		},
	);

	it.each(PERSONAS.map((persona) => [persona.id, persona] as const))(
		"%s embeds the model name and date when they are given",
		(_id, persona) => {
			const prompt = persona.render({ modelName: "Mock Chat", today: "2026-10-07" });
			expect(prompt).toContain("モデル名: Mock Chat");
			expect(prompt).toContain("今日の日付: 2026-10-07");
			expect(prompt.startsWith(persona.render({}))).toBe(true);
		},
	);

	it("gives each persona a distinct prompt", () => {
		const prompts = PERSONAS.map((persona) => persona.render({}));
		expect(new Set(prompts).size).toBe(PERSONAS.length);
	});

	it("tells the general assistant to answer in Japanese", () => {
		expect(getPersona("general-assistant").render({})).toContain("日本語");
	});

	it("addresses the Python mentor to learners who already know Python", () => {
		const prompt = getPersona("python-mentor").render({});
		expect(prompt).toContain("Python");
		expect(prompt).toContain("TypeScript");
		expect(prompt).toMatch(/Python の経験者/);
		expect(prompt).toMatch(/Python の基礎文法は説明しない/);
	});

	it("makes the strict reviewer rank findings by severity and cite evidence", () => {
		const prompt = getPersona("strict-reviewer").render({});
		expect(prompt).toMatch(/重大度/);
		expect(prompt).toMatch(/根拠/);
		expect(prompt).toMatch(/指摘がない場合/);
	});
});

describe("getPersona", () => {
	it("returns the template for a known id", () => {
		for (const persona of PERSONAS) {
			expect(getPersona(persona.id)).toBe(persona);
		}
	});

	it("throws an invalid-request PlatformError in Japanese for an unknown id", () => {
		let caught: unknown;
		try {
			getPersona("pirate");
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(PlatformError);
		const error = caught as PlatformError;
		expect(error.code).toBe("invalid-request");
		expect(error.message).toBe(
			"未知のペルソナ ID です。general-assistant, python-mentor, strict-reviewer のいずれかを指定してください。",
		);
		expect(error.details).toEqual({ personaId: "pirate" });
	});

	it("does not resolve inherited object keys as persona ids", () => {
		expect(() => getPersona("toString")).toThrow(PlatformError);
		expect(isPersonaId("toString")).toBe(false);
		expect(isPersonaId("constructor")).toBe(false);
	});
});

describe("isPersonaId / DEFAULT_PERSONA_ID", () => {
	it("narrows only listed ids", () => {
		expect(isPersonaId("python-mentor")).toBe(true);
		expect(isPersonaId("Python-Mentor")).toBe(false);
		expect(isPersonaId("")).toBe(false);
	});

	it("defaults to the general assistant", () => {
		expect(DEFAULT_PERSONA_ID).toBe("general-assistant");
		const persona: PersonaTemplate = getPersona(DEFAULT_PERSONA_ID);
		expect(persona.id).toBe(generalAssistant.id);
	});
});

import { describe, expect, it } from "vitest";
import {
	clipHead,
	clipTail,
	createAttemptLog,
	MAX_ATTEMPT_CODE_CHARACTERS,
	MAX_ERROR_SUMMARY_CHARACTERS,
} from "./attempts";

const ok = (code = "print(1)") => ({ code, stdout: "out\n", stderr: "" });
const failed = (code = "boom()", message = "'revenue'") => ({
	code,
	stdout: "",
	stderr: `Traceback...\nKeyError: ${message}`,
	error: { name: "KeyError", message, traceback: `Traceback...\nKeyError: ${message}` },
});

describe("clipHead", () => {
	it("leaves text up to the limit alone and cuts longer text with a note", () => {
		expect(clipHead("abcde", 5)).toBe("abcde");
		const cut = clipHead("abcdef", 5);
		expect(cut.startsWith("abcde")).toBe(true);
		expect(cut).toContain("省略");
		expect(cut).toContain("1");
	});

	it("counts characters, not UTF-16 units, and never leaves half of a pair", () => {
		const cut = clipHead("😀".repeat(10), 3);

		expect(cut.startsWith("😀😀😀")).toBe(true);
		expect(cut).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/u);
		expect(clipHead("😀".repeat(3), 3)).toBe("😀😀😀");
	});
});

describe("clipTail", () => {
	it("keeps the end of the text, where a traceback names the error", () => {
		const text = `${"a".repeat(20_000)}KeyError: 'x'`;

		const cut = clipTail(text, 8000);

		expect(cut.endsWith("KeyError: 'x'")).toBe(true);
		expect(cut).toContain("省略");
		expect([...cut].length).toBeLessThan(8100);
	});

	it("leaves text up to the limit alone", () => {
		expect(clipTail("abc", 3)).toBe("abc");
	});

	it("does not start in the middle of a surrogate pair", () => {
		const cut = clipTail("😀".repeat(10), 3);

		expect(cut).not.toMatch(/(?<![\ud800-\udbff])[\udc00-\udfff]/u);
		expect(cut.endsWith("😀😀😀")).toBe(true);
	});
});

describe("createAttemptLog", () => {
	it("numbers attempts from 1 and keeps the code as run", () => {
		const log = createAttemptLog({ maxFixAttempts: 3 });

		const first = log.record(ok("a"));
		const second = log.record(ok("b"));

		expect([first.index, second.index]).toEqual([1, 2]);
		expect(log.attempts().map((attempt) => attempt.code)).toEqual(["a", "b"]);
		expect(first).not.toHaveProperty("errorSummary");
	});

	it("cuts the code of an attempt at 8000 characters", () => {
		const log = createAttemptLog({ maxFixAttempts: 3 });

		const exact = log.record(ok("x".repeat(MAX_ATTEMPT_CODE_CHARACTERS)));
		const over = log.record(ok("x".repeat(MAX_ATTEMPT_CODE_CHARACTERS + 1)));

		expect(exact.code).toBe("x".repeat(MAX_ATTEMPT_CODE_CHARACTERS));
		expect(over.code.startsWith("x".repeat(MAX_ATTEMPT_CODE_CHARACTERS))).toBe(true);
		expect(over.code.length).toBeGreaterThan(MAX_ATTEMPT_CODE_CHARACTERS);
		expect(over.code).toContain("省略");
	});

	it("summarises an error as its name and the first line of its message", () => {
		const log = createAttemptLog({ maxFixAttempts: 3 });

		const attempt = log.record({
			...failed(),
			error: { name: "ValueError", message: "bad value\nsecond line", traceback: "tb" },
		});

		expect(attempt.errorSummary).toBe("ValueError: bad value");
	});

	it("cuts a long error summary", () => {
		const log = createAttemptLog({ maxFixAttempts: 3 });

		const attempt = log.record({
			...failed(),
			error: { name: "E", message: "m".repeat(1000), traceback: "tb" },
		});

		expect([...(attempt.errorSummary ?? "")].length).toBeLessThanOrEqual(
			MAX_ERROR_SUMMARY_CHARACTERS + 20,
		);
		expect(attempt.errorSummary).toContain("省略");
	});

	describe("counting fixes", () => {
		it("counts a run that follows a failure as a fix, and a first run or a run after a success as none", () => {
			const log = createAttemptLog({ maxFixAttempts: 3 });

			log.record(ok());
			log.record(ok());
			expect(log.fixes()).toBe(0);

			log.record(failed());
			expect(log.fixes()).toBe(0);
			log.record(failed());
			expect(log.fixes()).toBe(1);
			log.record(ok());
			expect(log.fixes()).toBe(2);
			log.record(ok());
			expect(log.fixes()).toBe(2);
		});

		it("allows the initial run and three fixes, then stops: the fourth fix never runs", () => {
			const log = createAttemptLog({ maxFixAttempts: 3 });
			const allowed: boolean[] = [];

			for (let run = 0; run < 5; run += 1) {
				allowed.push(log.canRun());
				if (log.canRun()) log.record(failed());
			}

			expect(allowed).toEqual([true, true, true, true, false]);
			expect(log.attempts()).toHaveLength(4);
			expect(log.fixes()).toBe(3);
			expect(log.exhausted()).toBe(true);
		});

		it("is exhausted as soon as the last allowed fix has failed, without waiting for another request", () => {
			const log = createAttemptLog({ maxFixAttempts: 2 });

			log.record(failed());
			log.record(failed());
			expect(log.exhausted()).toBe(false);
			log.record(failed());
			expect(log.exhausted()).toBe(true);
		});

		it("is not exhausted when the last fix succeeded, however many fixes it took", () => {
			const log = createAttemptLog({ maxFixAttempts: 2 });

			log.record(failed());
			log.record(failed());
			log.record(ok());

			expect(log.fixes()).toBe(2);
			expect(log.exhausted()).toBe(false);
			expect(log.canRun()).toBe(true);
		});

		it("with no fixes allowed, a first failure exhausts the log", () => {
			const log = createAttemptLog({ maxFixAttempts: 0 });

			expect(log.canRun()).toBe(true);
			log.record(failed());
			expect(log.exhausted()).toBe(true);
			expect(log.canRun()).toBe(false);
		});
	});

	it("reports the number of fixes it allows", () => {
		expect(createAttemptLog({ maxFixAttempts: 3 }).limit()).toBe(3);
		expect(createAttemptLog({ maxFixAttempts: 0 }).limit()).toBe(0);
	});

	describe("the budget is per failure, not per analysis", () => {
		it("gives a fresh failure its own fixes after a success, however many fixes came before", () => {
			const log = createAttemptLog({ maxFixAttempts: 3 });

			// F S F S F S F: every failure after the first is a new failure with three fixes ahead.
			for (const run of [failed(), ok(), failed(), ok(), failed(), ok(), failed()]) {
				log.record(run);
			}

			expect(log.fixes()).toBe(3);
			expect(log.exhausted()).toBe(false);
			expect(log.canRun()).toBe(true);
		});

		it("still stops a single failure after its three fixes, whatever happened before", () => {
			const log = createAttemptLog({ maxFixAttempts: 3 });
			log.record(failed());
			log.record(ok());

			for (let run = 0; run < 4; run += 1) log.record(failed());

			expect(log.exhausted()).toBe(true);
			expect(log.canRun()).toBe(false);
			// Four fixes counted in total: the one that cured the first failure, and three for the second.
			expect(log.fixes()).toBe(4);
		});
	});

	it("hands out a copy of the attempts", () => {
		const log = createAttemptLog({ maxFixAttempts: 3 });
		log.record(ok());

		const copy = log.attempts() as unknown[];
		copy.length = 0;

		expect(log.attempts()).toHaveLength(1);
	});

	it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects %s as maxFixAttempts",
		(value) => {
			expect(() => createAttemptLog({ maxFixAttempts: value })).toThrow(RangeError);
		},
	);
});

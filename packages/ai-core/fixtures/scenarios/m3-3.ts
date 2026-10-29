import { defineScenario, type ScenarioDefinition } from "../../src/mock/scenario";
import { MOCK_ERROR_MARKER } from "../../src/sandbox/mock-marker";

// Mock responses for module 3-3 (the data-analysis agent). The model writes code for `runPython`;
// the mock sandbox answers from fixtures (it runs nothing), failing exactly when the code carries
// `MOCK_ERROR_MARKER`. So each scenario scripts the code the model "writes" and the mock decides
// whether that run succeeds:
//
//   success        one run that succeeds
//   fixed          a run that fails, then a fixed run that succeeds (one fix)
//   attempt-limit  four runs that all fail (the first run and three fixes), so the run is stopped
//
// Every turn names the instruction, so none answers a turn of another scenario.

/** Instructions that the scenarios below answer; the UI offers them as input examples in `mock`. */
export const M3_3_SAMPLE_INSTRUCTIONS = Object.freeze({
	success: "月ごとの売上を集計して、棒グラフと表で見せてください。",
	fixed: "地域ごとの売上を集計して、結果を表で見せてください。",
	attemptLimit: "存在しない列「revenue」の合計を計算してください。",
});

const MONTHLY_CODE = [
	"import pandas as pd",
	"import matplotlib.pyplot as plt",
	"",
	'df = pd.read_csv("data.csv")',
	'monthly = df.groupby(df["date"].str[:7], as_index=False)["sales"].sum()',
	'plt.bar(monthly["date"], monthly["sales"])',
	'plt.title("月別売上")',
	'show_figure("月別売上の棒グラフ")',
	'show_table(monthly, "月別売上")',
].join("\n");

/** Reads a column that does not exist; the marker makes the mock sandbox fail the run. */
const failingCode = (attempt: number) =>
	[
		MOCK_ERROR_MARKER,
		"import pandas as pd",
		"",
		'df = pd.read_csv("data.csv")',
		`print(df["revenue"].sum())  # attempt ${attempt}`,
	].join("\n");

const REGION_CODE = [
	"import pandas as pd",
	"",
	'df = pd.read_csv("data.csv")',
	'by_region = df.groupby("region", as_index=False)["sales"].sum()',
	'show_table(by_region, "地域別売上")',
].join("\n");

const runPythonCall = (code: string) => ({ toolName: "runPython", input: { code } });

/** A turn at `stepIndex` of the run for `instruction`; steps after the first follow a tool result. */
function turn(
	instruction: string,
	stepIndex: number,
	respond: { toolCalls: ReturnType<typeof runPythonCall>[] } | { text: string },
) {
	return {
		match:
			stepIndex === 0
				? { purpose: "chat" as const, lastUserTextIncludes: instruction, stepIndex }
				: {
						purpose: "chat" as const,
						lastUserTextIncludes: instruction,
						stepIndex,
						toolResultFor: "runPython",
					},
		respond: {
			...respond,
			usage: { inputTokens: 420 + stepIndex * 180, outputTokens: "text" in respond ? 80 : 160 },
		},
	};
}

export const M3_3_SCENARIOS: readonly ScenarioDefinition[] = [
	defineScenario({
		id: "m3-3/analysis/success",
		turns: [
			turn(M3_3_SAMPLE_INSTRUCTIONS.success, 0, { toolCalls: [runPythonCall(MONTHLY_CODE)] }),
			turn(M3_3_SAMPLE_INSTRUCTIONS.success, 1, {
				text: "月ごとの売上を集計しました。上の棒グラフと表のとおり、3 月がいちばん多くなっています。",
			}),
		],
	}),
	defineScenario({
		id: "m3-3/analysis/fixed",
		turns: [
			turn(M3_3_SAMPLE_INSTRUCTIONS.fixed, 0, { toolCalls: [runPythonCall(failingCode(1))] }),
			turn(M3_3_SAMPLE_INSTRUCTIONS.fixed, 1, { toolCalls: [runPythonCall(REGION_CODE)] }),
			turn(M3_3_SAMPLE_INSTRUCTIONS.fixed, 2, {
				text: "列名を直して、地域ごとの売上を集計しました。結果は上の表のとおりです。",
			}),
		],
	}),
	defineScenario({
		id: "m3-3/analysis/attempt-limit",
		turns: [
			turn(M3_3_SAMPLE_INSTRUCTIONS.attemptLimit, 0, {
				toolCalls: [runPythonCall(failingCode(1))],
			}),
			turn(M3_3_SAMPLE_INSTRUCTIONS.attemptLimit, 1, {
				toolCalls: [runPythonCall(failingCode(2))],
			}),
			turn(M3_3_SAMPLE_INSTRUCTIONS.attemptLimit, 2, {
				toolCalls: [runPythonCall(failingCode(3))],
			}),
			turn(M3_3_SAMPLE_INSTRUCTIONS.attemptLimit, 3, {
				toolCalls: [runPythonCall(failingCode(4))],
			}),
			// Never reached: the run is stopped after the fourth failed run.
			turn(M3_3_SAMPLE_INSTRUCTIONS.attemptLimit, 4, {
				text: "列「revenue」が見つからず、集計できませんでした。",
			}),
		],
	}),
];

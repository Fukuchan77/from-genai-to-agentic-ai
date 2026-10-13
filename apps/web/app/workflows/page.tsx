import { DEFAULT_WORKFLOW_LIMITS } from "@platform/ai-core/config";
import { M2_3_SAMPLE_TASKS, M2_4_SAMPLE_TASKS } from "@platform/ai-core/mock";
import { PATTERN_DEMO_NAMES } from "@platform/ai-core/patterns";
import { WORKFLOW_DEMO_NAMES } from "@platform/ai-core/workflows";
import type { Metadata } from "next";
import { WorkflowPanel, type WorkflowSample } from "@/components/workflows/WorkflowPanel";

export const metadata: Metadata = { title: "ワークフローとパターン" };

// The input task limit of `POST /api/workflows` (the route enforces the same number).
const TASK_MAX_CHARACTERS = 4_000;

const WORKFLOW_SAMPLES = M2_3_SAMPLE_TASKS;
const PATTERN_SAMPLES = M2_4_SAMPLE_TASKS;

// Input examples per name. They are the tasks the `mock` scenarios answer, so every example also
// runs offline; in `local` and `live` they are ordinary suggestions.
const SAMPLES: Readonly<Record<string, readonly WorkflowSample[]>> = {
	"prompt-chaining": [
		{ label: "VPN の手順", task: WORKFLOW_SAMPLES.promptChain.ok },
		{ label: "本文の検証に失敗する例", task: WORKFLOW_SAMPLES.promptChain.bodyFails },
	],
	routing: [
		{ label: "技術的な問い合わせ", task: WORKFLOW_SAMPLES.routing.technical },
		{ label: "範囲外の問い合わせ", task: WORKFLOW_SAMPLES.routing.outOfScope },
	],
	"model-routing": [
		{ label: "易しい質問", task: WORKFLOW_SAMPLES.modelRouting.easy },
		{ label: "難しい質問", task: WORKFLOW_SAMPLES.modelRouting.hard },
	],
	"parallel-sectioning": [{ label: "ポータル導入の検討", task: WORKFLOW_SAMPLES.sectioning }],
	"parallel-voting": [{ label: "導入案の承認", task: WORKFLOW_SAMPLES.voting }],
	"orchestrator-workers": [
		{ label: "3 つに分ける計画書", task: WORKFLOW_SAMPLES.orchestrator.three },
		{ label: "2 つに分ける一言まとめ", task: WORKFLOW_SAMPLES.orchestrator.two },
	],
	"evaluator-optimizer": [
		{ label: "改善して合格する例", task: WORKFLOW_SAMPLES.evaluator.improves },
		{ label: "改善が進まず未合格になる例", task: WORKFLOW_SAMPLES.evaluator.stalls },
	],
	"passive-goal-creator": [
		{ label: "十分な指示", task: PATTERN_SAMPLES.passiveGoal.sufficient },
		{ label: "曖昧な指示", task: PATTERN_SAMPLES.passiveGoal.ambiguous },
	],
	"prompt-response-optimizer": [
		{ label: "プロンプト", task: PATTERN_SAMPLES.optimizer.prompt },
		{ label: "応答", task: PATTERN_SAMPLES.optimizer.response },
	],
	"single-path-plan": [{ label: "研修資料の作成", task: PATTERN_SAMPLES.singlePath }],
	"multi-path-plan": [{ label: "問い合わせ対応の効率化", task: PATTERN_SAMPLES.multiPath }],
	"self-reflection": [{ label: "ポータルの紹介文", task: PATTERN_SAMPLES.selfReflection }],
	"cross-reflection": [{ label: "リリースノート", task: PATTERN_SAMPLES.crossReflection }],
	"role-based-cooperation": [{ label: "利用状況の調査と集計", task: PATTERN_SAMPLES.roleBased }],
};

export default function WorkflowsPage() {
	return (
		<div className="flex flex-col gap-6">
			<h1 className="text-2xl font-bold">ワークフローとエージェントパターン</h1>
			<p className="text-muted-foreground">
				モデル呼び出しを組み合わせる 5 つのワークフローと、6
				つのエージェントデザインパターンを実行し、途中経過と結果を確かめます。
			</p>
			<WorkflowPanel
				names={{ workflow: WORKFLOW_DEMO_NAMES, pattern: PATTERN_DEMO_NAMES }}
				samples={SAMPLES}
				limits={DEFAULT_WORKFLOW_LIMITS}
				taskMaxLength={TASK_MAX_CHARACTERS}
			/>
		</div>
	);
}

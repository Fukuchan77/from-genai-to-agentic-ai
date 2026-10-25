import type { Route } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlatform } from "@/lib/server/platform";

// The run mode comes from the environment of the running server, not from the build.
export const dynamic = "force-dynamic";

const RUN_MODE_LABELS = {
	mock: "モック（固定データで動作。ネットワーク不要）",
	local: "ローカル（Ollama のモデルで動作）",
	live: "ライブ（外部プロバイダの API を使用）",
} as const;

const MODULES: readonly {
	readonly href: Route;
	readonly title: string;
	readonly description: string;
}[] = [
	{
		href: "/chat" as Route,
		title: "チャット",
		description: "モデルとペルソナを切り替えながら、応答をストリーミングで受け取ります。",
	},
	{
		href: "/agent" as Route,
		title: "ツールエージェント",
		description: "エージェントが呼び出したツールの過程と結果を、型付きの部品で確認します。",
	},
	{
		href: "/summarize" as Route,
		title: "要約",
		description: "記事や YouTube の字幕を、構造化された要約として生成します。",
	},
	{
		href: "/rag" as Route,
		title: "RAG",
		description: "文書を取り込み、検索の手法を切り替えながら、引用付きの回答を得ます。",
	},
	{
		href: "/workflows" as Route,
		title: "ワークフローとパターン",
		description:
			"ワークフロー 5 種とエージェントのデザインパターンを実行し、途中経過を確かめます。",
	},
	{
		href: "/mcp" as Route,
		title: "MCP",
		description: "MCP サーバーのツールを許可リストで絞って読み込み、エージェントに使わせます。",
	},
	{
		href: "/helpdesk" as Route,
		title: "ヘルプデスク",
		description: "問い合わせを計画に分けて処理し、計画の修正とチケットの状態を確かめます。",
	},
	{
		href: "/analysis" as Route,
		title: "データ分析",
		description: "CSV や Excel をアップロードし、サンドボックスで生成コードを実行して分析します。",
	},
	{
		href: "/research" as Route,
		title: "リサーチ",
		description: "Supervisor が専門のサブエージェントを呼び、論文を調べてレポートにまとめます。",
	},
	{
		href: "/requirements" as Route,
		title: "要件定義",
		description: "ペルソナの質問に答えながら、要件を整理して要件定義書を作ります。",
	},
	{
		href: "/marketing" as Route,
		title: "マーケティング",
		description: "ペルソナの合議で文案を磨き、好みに合う商品をおすすめします。",
	},
];

export default async function HomePage() {
	const { mode, config } = await getPlatform();

	return (
		<div className="flex flex-col gap-8">
			<section aria-labelledby="home-title" className="flex flex-col gap-3">
				<h1 id="home-title" className="text-2xl font-bold">
					GenAI から Agentic AI へ
				</h1>
				<p className="text-muted-foreground">
					AI
					エージェントを作り、評価し、運用するための実習アプリです。次のモジュールから始めてください。
				</p>
			</section>

			<section aria-labelledby="run-mode-title" className="flex flex-col gap-2">
				<h2 id="run-mode-title" className="text-lg font-semibold">
					実行モード
				</h2>
				<p className="flex flex-wrap items-center gap-2">
					<Badge variant="outline" data-testid="run-mode">
						{mode}
					</Badge>
					<span>{RUN_MODE_LABELS[mode]}</span>
					{config.recording ? <Badge variant="secondary">録画中</Badge> : null}
				</p>
			</section>

			<section aria-labelledby="modules-title" className="flex flex-col gap-3">
				<h2 id="modules-title" className="text-lg font-semibold">
					モジュール一覧
				</h2>
				<ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{MODULES.map((module) => (
						<li key={module.href}>
							<Card className="h-full">
								<CardHeader>
									<CardTitle as="h3">
										<Link
											href={module.href}
											className="rounded-sm underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2"
										>
											{module.title}
										</Link>
									</CardTitle>
									<CardDescription>{module.description}</CardDescription>
								</CardHeader>
								<CardContent className="text-sm text-muted-foreground">
									<code>{module.href}</code>
								</CardContent>
							</Card>
						</li>
					))}
				</ul>
			</section>
		</div>
	);
}

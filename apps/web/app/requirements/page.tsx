import {
	MESSAGES_REQUEST_LIMITS,
	REQUIREMENTS_REQUEST_LIMITS,
} from "@platform/ai-core/requirements";
import type { Metadata } from "next";
import { InterviewPanel } from "@/components/requirements/InterviewPanel";

export const metadata: Metadata = { title: "要件定義" };

export default function RequirementsPage() {
	return (
		<div className="flex flex-col gap-6">
			<h1 className="text-2xl font-bold">要件定義インタビュー</h1>
			<p className="text-muted-foreground">
				プロダクトの概要を入力すると、想定ユーザー（ペルソナ）が決まり、ペルソナごとの質問に答えながら要件を整理できます。情報が十分に集まると、要件定義書をダウンロードできます。
			</p>
			<InterviewPanel
				overviewMaxLength={REQUIREMENTS_REQUEST_LIMITS.overviewMaxCharacters}
				answerMaxLength={MESSAGES_REQUEST_LIMITS.textMaxCharacters}
			/>
		</div>
	);
}

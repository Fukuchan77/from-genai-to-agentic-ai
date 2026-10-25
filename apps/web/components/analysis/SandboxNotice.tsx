import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { UploadLimits } from "./UploadForm";

/** The `sandbox` field of `GET /api/analysis/status`. */
export type SandboxStatus =
	| { readonly kind: "e2b" | "docker" | "mock" }
	| { readonly kind: "disabled"; readonly reason: string; readonly guidance: string };

/** The body of `GET /api/analysis/status` (plan C13). */
export interface AnalysisStatusResponse {
	readonly sandbox: SandboxStatus;
	readonly upload: UploadLimits;
}

const kindLabels = {
	e2b: "E2B のクラウドサンドボックス",
	docker: "ローカルの Docker コンテナ",
	mock: "疑似サンドボックス（mock モード）",
} as const;

/**
 * Says which sandbox runs the generated code, or why the analysis is disabled and what to set up
 * (Req 3.8). The reason and the guidance come from the server as they are: no setting name is
 * written in client code (plan C16, checked by the client bundle scan).
 */
export function SandboxNotice({ sandbox }: { readonly sandbox: SandboxStatus }) {
	if (sandbox.kind === "disabled") {
		return (
			<Alert role="status">
				<AlertTitle>分析エージェントは無効です</AlertTitle>
				<AlertDescription>
					<p>{sandbox.reason}</p>
					<p>{sandbox.guidance}</p>
				</AlertDescription>
			</Alert>
		);
	}
	return (
		<p role="status" className="text-sm text-muted-foreground">
			{`コードの実行環境: ${kindLabels[sandbox.kind]}`}
		</p>
	);
}

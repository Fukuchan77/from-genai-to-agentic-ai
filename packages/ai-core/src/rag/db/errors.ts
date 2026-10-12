import { PlatformError } from "../../errors";

/** The knowledge base cannot be reached; the message tells a learner how to start it. */
export class KnowledgeBaseUnavailableError extends PlatformError {
	constructor(message?: string, details?: Readonly<Record<string, unknown>>) {
		super(
			"provider-unavailable",
			message ??
				"ナレッジベース（Postgres）に接続できません。`mise run services:up:db` でデータベースを起動してから、もう一度実行してください。",
			details,
		);
	}
}

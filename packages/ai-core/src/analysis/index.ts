// Public API of `@platform/ai-core/analysis` (plan C7). The sandbox is reached through the
// `SandboxSession` port only; the providers live in `@platform/ai-core/sandbox`.
export {
	ANALYSIS_INSTRUCTIONS,
	type AnalysisFile,
	type AnalysisResult,
	type AnalysisStatus,
	analysisLoopLimits,
	defaultAnalysisLimits,
	type RunAnalysisParams,
	runAnalysis,
} from "./agent";
export {
	type AnalysisAttempt,
	type AttemptLog,
	createAttemptLog,
	MAX_ATTEMPT_CODE_CHARACTERS,
} from "./attempts";
export {
	DEFAULT_OUTPUT_LIMITS,
	type Figure,
	type OutputLimits,
	type ParsedSandboxOutput,
	PNG_MARKER,
	parseSandboxOutput,
	TABLE_MARKER,
	type Table,
	type TableCell,
} from "./output-parser";
export { ANALYSIS_HELPERS_FILE, analysisPrelude, helpersImportLine } from "./prelude";
export {
	type AnalysisEvent,
	createRunPythonTool,
	RUN_PYTHON_TOOL_NAME,
	type RunPythonResult,
} from "./run-python-tool";
export {
	type CheckUploadParams,
	checkUpload,
	type UploadCheck,
	type UploadKind,
	type UploadRejection,
	uploadKindOf,
} from "./upload-check";

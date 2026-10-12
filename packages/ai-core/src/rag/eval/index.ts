// Public API of the RAG evaluation area (plan C10); re-exported from `@platform/ai-core/rag`.
export {
	EVAL_SET_ERROR_REASONS,
	type EvalQuestion,
	EvalSetError,
	type EvalSetErrorReason,
	evalQuestionSchema,
	loadEvalSet,
	MIN_EVAL_QUESTIONS,
} from "./dataset";
export {
	ANSWER_RELEVANCE_RUBRIC,
	type AxisJudgement,
	FAITHFULNESS_RUBRIC,
	JUDGE_AXES,
	JUDGE_VERDICTS,
	type JudgeAxis,
	type JudgeChunk,
	type JudgeModel,
	type JudgeRagAnswerParams,
	type JudgeVerdict,
	judgeAxisMarker,
	judgeRagAnswer,
} from "./judge";
export {
	type CombinationResult,
	type CompareMethodsOptions,
	compareMethods,
	hitRateAtK,
	type MethodCombination,
	type MethodComparison,
	meanRecallAtK,
	type QuestionRetrievalResult,
	recallAtK,
	type ScorableQuestion,
} from "./recall";

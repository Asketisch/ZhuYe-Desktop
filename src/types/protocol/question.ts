/**
 * Reflect 协议 —— Question / QuestionOption / Answer / AskUserAnswer。
 *
 * 对应 `zhuye-agent/crates/protocol/reflect-protocol/src/question.rs`（结构化多题提示）。
 * 所有 wire-format 字段名使用 snake_case。
 *
 * 顶层同步警告见 `./index.ts`。
 */

export interface Question {
  header: string;
  question: string;
  options: QuestionOption[];
  multi_select: boolean;
}

export interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface Answer {
  selected?: number[];
  custom?: string;
}

export interface AskUserAnswer {
  answers: Answer[];
}

/**
 * 询问用户封装 —— 响应 agent 通过 `zhuye_event` 流提出的问题。
 */
import { invoke } from '../bridge';
import type { AskUserAnswer } from '@/types/protocol';

/** 回答结构化问题。 */
export async function zhuye_ask_user_question_response(id: string, answers: AskUserAnswer): Promise<string> {
  return invoke<string>('zhuye_ask_user_question_response', { id, answers });
}

/** 以自由文本回答一个澄清请求。 */
export async function zhuye_ask_user_input_response(id: string, text: string): Promise<string> {
  return invoke<string>('zhuye_ask_user_input_response', { id, text });
}

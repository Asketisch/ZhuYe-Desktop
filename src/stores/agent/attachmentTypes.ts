/**
 * 用户附件的可渲染元数据(A2)—— 从 `types.ts` 拆出的专题类型
 * (types.ts 逼近 500 行预算,沿用 tokenTypes.ts 的拆分先例)。
 */
export type UserAttachmentMeta =
  | { kind: 'image'; src: string; mime: string }
  | { kind: 'file'; path: string; range?: { start_line: number; end_line: number } };

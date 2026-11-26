/**
 * 用户附件的可渲染元数据(A2)—— 从 `types.ts` 拆出的专题类型
 * (types.ts 逼近 500 行预算,沿用 tokenTypes.ts 的拆分先例)。
 */
export type UserAttachmentMeta =
  | {
      kind: 'image';
      src: string;
      mime: string;
      /** 来源标记原文(如 `[图片 #1：剪贴板粘贴]`,见 imageProvenance)——回放还原与一键重生成重发用;缺省 = 旧会话无标记。 */
      source?: string;
    }
  | { kind: 'file'; path: string; range?: { start_line: number; end_line: number } };

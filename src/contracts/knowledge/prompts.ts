import type { I18nContextValue } from '@/utils/i18n/context';
export interface PromptTemplateView {
  id: string;
  name: string;
  description: string;
  body: string;
}
export interface PromptsViewProps {
  t: I18nContextValue['t'];
  prompts: PromptTemplateView[];
  selectedId: string | null;
  sentId: string | null;
  onToggle: (id: string) => void;
  onSend: (id: string) => void;
}

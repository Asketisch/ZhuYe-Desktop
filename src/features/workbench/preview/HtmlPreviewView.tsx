import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { HtmlPreviewBinding } from '@/logic/workbench/preview/HtmlPreviewBinding';
import { HtmlPreviewView as DefaultView } from '@/render/workbench/preview/HtmlPreviewView';

export function HtmlPreviewView() {
  const View = useRenderView('HtmlPreviewView', DefaultView);
  return <HtmlPreviewBinding view={View} />;
}

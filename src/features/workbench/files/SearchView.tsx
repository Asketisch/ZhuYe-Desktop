import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { SearchBinding } from '@/logic/workbench/search/SearchBinding';
import { SearchView as DefaultView } from '@/render/workbench/search/SearchView';

export function SearchView() {
  const View = useRenderView('SearchView', DefaultView);
  return <SearchBinding view={View} />;
}

import { useRenderView } from '@/logic/renderer/useRenderView';
import { SearchBinding } from '@/logic/search/SearchBinding';
import { SearchView as DefaultView } from '@/render/workbench/search/SearchView';

export function SearchView() {
  const View = useRenderView('SearchView', DefaultView);
  return <SearchBinding view={View} />;
}

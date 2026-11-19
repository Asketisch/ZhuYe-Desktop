import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(root, 'src');
const renderRoot = resolve(sourceRoot, 'render');
const logicRoot = resolve(sourceRoot, 'logic');
const contractRoot = resolve(sourceRoot, 'contracts');
const legacyFeaturesRoot = resolve(sourceRoot, 'features');
const compatibilityPrefs = [resolve(sourceRoot, 'utils/theme'), resolve(sourceRoot, 'utils/uiPrefs')];
const inside = (file, directory) => file === directory || file.startsWith(directory + sep);
const hostGlobals = new Set(['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'globalThis']);

function resolveImport(file, name) {
  if (name.startsWith('@/')) return resolve(sourceRoot, name.slice(2));
  if (name.startsWith('.')) return resolve(dirname(file), name);
  return null;
}

/** 检查单个模块，供门禁和自测共用。 */
export function checkSource(file, code) {
  const errors = [];
  const render = inside(file, renderRoot);
  const logic = inside(file, logicRoot);
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const report = (node, message) => {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    errors.push(`${relative(root, file)}:${position.line + 1}:${position.character + 1} ${message}`);
  };
  const checkImport = (node, specifier, typeOnly = false) => {
    if (!specifier || !ts.isStringLiteral(specifier)) {
      report(node, '动态导入必须使用静态字符串');
      return;
    }
    const name = specifier.text;
    const target = resolveImport(file, name);
    if (render && target && !inside(target, renderRoot) && !(typeOnly && inside(target, contractRoot))) {
      report(node, `渲染层不可依赖 ${name}`);
    }
    if (render && !target && name !== 'react' && name !== 'react/jsx-runtime' && name !== 'lucide-react') {
      report(node, `渲染层不可依赖 ${name}`);
    }
    if (logic && ((target && (inside(target, renderRoot) || inside(target, legacyFeaturesRoot) || compatibilityPrefs.includes(target))) || /\.css(?:$|\?)/.test(name) || name === 'lucide-react')) {
      report(node, `逻辑层不可依赖界面资源 ${name}`);
    }
    if (render && name === 'react' && ts.isImportDeclaration(node)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const item of bindings.elements) {
          const imported = (item.propertyName ?? item.name).text;
          if (/^use[A-Z]/.test(imported) && !item.isTypeOnly && !node.importClause?.isTypeOnly) {
            report(item, '渲染层不可使用 React hook');
          }
        }
      }
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) checkImport(node, node.moduleSpecifier, !!node.isTypeOnly || !!node.importClause?.isTypeOnly);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      checkImport(node, node.arguments[0]);
    }
    if ((render || logic) && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      report(node, '请使用静态导入');
    }
    if ((render || logic) && ts.isImportEqualsDeclaration(node)) {
      report(node, '请使用 ES 模块导入');
    }
    if (render && ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
      && /^use[A-Z]/.test(node.argumentExpression.text)) {
      report(node, '渲染层不可使用 hook');
    }
    if (render && ts.isPropertyAccessExpression(node) && /^use[A-Z]/.test(node.name.text)) {
      report(node, '渲染层不可使用 hook');
    }
    if (render && ts.isIdentifier(node) && hostGlobals.has(node.text)
      && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) {
      report(node, `渲染层不可访问宿主对象 ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return errors;
}

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) return filesIn(file);
    return /\.(?:ts|tsx)$/.test(file) && !/\.test\.(?:ts|tsx)$/.test(file) ? [file] : [];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = [renderRoot, logicRoot].flatMap(filesIn).flatMap((file) => checkSource(file, readFileSync(file, 'utf8')));
  // 旧功能目录中的 CSS 必须位于渲染层，避免换肤时遗漏样式。
  for (const file of filesIn(legacyFeaturesRoot)) {
    const code = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
        && ts.isStringLiteral(node.moduleSpecifier) && /\.css(?:\?|$)/.test(node.moduleSpecifier.text)) {
        const target = resolveImport(file, node.moduleSpecifier.text);
        if (target && !inside(target, renderRoot)) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          errors.push(`${relative(root, file)}:${position.line + 1}:${position.character + 1} 功能目录不可持有渲染样式 ${node.moduleSpecifier.text}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  if (errors.length) {
    process.stderr.write(`${errors.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('渲染与逻辑目录依赖检查通过\n');
  }
}

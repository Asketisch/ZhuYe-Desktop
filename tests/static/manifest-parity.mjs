// tests/static/manifest-parity.mjs —— submodule 清单奇偶校验(L1 静态审查)。
//
// 用法:node manifest-parity.mjs <submodule Cargo.toml> <root Cargo.toml>
//
// Cargo 不支持嵌套 workspace:核心 crate 经 path 被本仓库消费时,它们的
// `workspace = true` 一律解析到**本仓库根 Cargo.toml**。子模块
// `[workspace.dependencies]` 新增的每个键都必须在根清单镜像,否则
// `cargo metadata` 对整个工作区报错,什么都编不了。
//
// 退出码:0 = 根清单完整镜像;1 = 有缺键(逐个点名)或清单不可解析。
import fs from 'node:fs';

const [sub, root] = process.argv.slice(2);
if (!sub || !root) {
  console.log('用法: node manifest-parity.mjs <submodule Cargo.toml> <root Cargo.toml>');
  process.exit(2);
}

/** 取 `[workspace.dependencies]` 段内所有顶层键(行首 `key =`)。 */
export function workspaceDependencyKeys(toml) {
  const keys = new Set();
  let inSection = false;
  for (const line of toml.split(/\r?\n/)) {
    // 段头只认行首 `[`:多行 features 数组的续行不会以 `[` 开头。
    if (/^\[/.test(line)) {
      inSection = line.trim() === '[workspace.dependencies]';
      continue;
    }
    if (!inSection) continue;
    const m = line.match(/^([A-Za-z0-9_-]+)\s*=/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

const subKeys = workspaceDependencyKeys(fs.readFileSync(sub, 'utf8'));
const rootKeys = workspaceDependencyKeys(fs.readFileSync(root, 'utf8'));
if (subKeys.size === 0) {
  console.log('子模块 [workspace.dependencies] 解析为空 —— 清单格式变了?');
  process.exit(1);
}
const missing = [...subKeys].filter((k) => !rootKeys.has(k)).sort();
if (missing.length) {
  console.log(
    `根 Cargo.toml [workspace.dependencies] 缺少子模块继承键(${missing.length}):${missing.join(' ')}`,
  );
  console.log('→ 按 zhuye-agent/Cargo.toml 同名同版本补到根清单(含 zhuye-* 的 path 项与外部依赖)');
  process.exit(1);
}
console.log(`根清单完整镜像子模块 ${subKeys.size} 个 workspace.dependencies 继承键`);

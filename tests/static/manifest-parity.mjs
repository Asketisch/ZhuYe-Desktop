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

/**
 * 取 `[workspace.lints.clippy]` 段内 level=allow 的键(裸 `"allow"` 或
 * `{ level = "allow" }` 两种形态)。
 *
 * submodule crate 的 `[lints] workspace = true` 与 workspace.dependencies
 * 同机制 —— 解析到**本仓库根**。上游若把某条 clippy lint 设为 allow(其
 * M1 宽松清单),而根清单没有同名 allow,该 lint 会回落到 `all = "deny"`
 * 的基线,在上游存量代码上误报(2026-11 接线 main 时实测:collapsible_if
 * / derivable_impls 等 11 条)。deny 级键是上游内部纪律,桌面**不**强制
 * 镜像(只查 allow:那是上游代码在桌面策略下编译的**必要条件**)。
 */
export function clippyAllowKeys(toml) {
  const keys = new Set();
  let inSection = false;
  for (const line of toml.split(/\r?\n/)) {
    if (/^\[/.test(line)) {
      inSection = line.trim() === '[workspace.lints.clippy]';
      continue;
    }
    if (!inSection) continue;
    const m = line.match(
      /^([A-Za-z0-9_-]+)\s*=\s*(?:"allow"|{\s*level\s*=\s*"allow")/,
    );
    if (m) keys.add(m[1]);
  }
  return keys;
}

const subToml = fs.readFileSync(sub, 'utf8');
const rootToml = fs.readFileSync(root, 'utf8');
const subKeys = workspaceDependencyKeys(subToml);
const rootKeys = workspaceDependencyKeys(rootToml);
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

// ── lints 奇偶:子模块 clippy allow 键必须在根清单同名同级别镜像 ──
const subAllows = clippyAllowKeys(subToml);
const rootAllows = clippyAllowKeys(rootToml);
const missingLints = [...subAllows].filter((k) => !rootAllows.has(k)).sort();
if (missingLints.length) {
  console.log(
    `根 Cargo.toml [workspace.lints.clippy] 缺少子模块 allow 继承键(${missingLints.length}):${missingLints.join(' ')}`,
  );
  console.log('→ submodule 的 `[lints] workspace = true` 解析到本仓库根(与 dependencies 同机制):按 zhuye-agent/Cargo.toml 同名同级别补 allow,否则上游存量代码在 all=deny 基线下误报');
  process.exit(1);
}
if (subAllows.size > 0) {
  console.log(`根清单镜像子模块 ${subAllows.size} 个 clippy allow 继承键`);
}

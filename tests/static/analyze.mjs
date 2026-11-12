#!/usr/bin/env node
/**
 * 静态审查分析器 —— 发布门禁 L1 的源码级检查。
 *
 * 为什么用 Node 而不是纯 shell:命令面 / 路由 / 命名空间的交叉比对需要
 * 真正的解析,grep 只能给出"看起来对"的结论。这里做**全量**比对,不做抽样。
 *
 * 用法:node tests/static/analyze.mjs [输出文件]
 *   - 每行输出一条用例结果:`PASS|FAIL|SKIP \t 用例名 [\t 原因]`
 *   - 退出码 0 = 无 FAIL
 *
 * 棘轮(ratchet)检查:某些指标当前存量不达标(历史债),直接当门禁会永久
 * 变红。这类检查与 `tests/static/baseline.json` 比对 —— **新增**违规立即
 * 失败,存量记为 WARN 并留在基线里,等偿还。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countLines } from './line-count.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const BASELINE_PATH = join(ROOT, 'tests', 'static', 'baseline.json');

/** 输出路径可以是绝对的(门禁把结果写到 `.test-results/`)或相对仓库根的。 */
const resolveOut = (p) => (isAbsolute(p) ? p : join(ROOT, p));

// ── 输出累加器 ─────────────────────────────────────────────────────────────
const results = [];
const emit = (status, name, reason) => {
  results.push({ status, name, reason: reason ?? '' });
};
const pass = (name, detail) => emit('PASS', name, detail);
const fail = (name, reason) => emit('FAIL', name, reason);
const skip = (name, reason) => emit('SKIP', name, reason);

// ── 通用文件工具 ───────────────────────────────────────────────────────────
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir, filter, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'target' || entry.name === 'dist') continue;
      walk(rel, filter, out);
    } else if (filter(rel)) {
      out.push(rel);
    }
  }
  return out;
}

const isTestFile = (p) => /\.(test|spec)\.[jt]sx?$/.test(p) || p.includes('/test/');
const isProdSource = (p) =>
  /^(src|src-tauri\/src|app-core\/src)\//.test(p) && !isTestFile(p);

// ── 1. 命令面:后端实现 ↔ 注册表 ↔ 前端包装 ─────────────────────────────────
const cmdDir = 'src-tauri/src/commands';
// 命令体可以落在领域子目录(如 `commands/files/image.rs`,与
// `config/tests.rs` / `sessions/title_commit.rs` 同一布局)—— 递归扫描。
const backendFiles = walk(cmdDir, (f) => f.endsWith('.rs'));
const backendSrc = backendFiles.map((f) => read(f)).join('\n');

// 后端命令体:`#[tauri::command]` 标注的 `pub fn` / `pub async fn`。
const backendCommands = new Set(
  [...backendSrc.matchAll(/pub (?:async )?fn (reflect_\w+)/g)].map((m) => m[1]),
);

// 生产命令文件内的 `#[cfg(test)]` 单元测试同样属于命令测试证据;
// IPC 测试扫描只负责集成路径,不能把模块内测试误判为“无测试”。
const commandUnitTested = new Set();
for (const file of backendFiles) {
  const source = read(file);
  if (!source.includes('#[cfg(test)]')) continue;
  for (const match of source.matchAll(/"(reflect_\w+)"/g)) {
    commandUnitTested.add(match[1]);
  }
}

const libSrc = read('src-tauri/src/lib.rs');
const handlerMatch = libSrc.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/);
if (!handlerMatch) {
  fail('registry-parse', 'lib.rs 里找不到 generate_handler! 注册表');
} else {
  // 注册表里既有命令也有注释(`// Task/Team 管理命令(…,包装 reflect_task::TaskManager)`)。
  // 必须先剥掉行注释,否则 `reflect_task` / `reflect_stream` 这类**注释里
  // 提到的 crate 名**会被当成"已注册但前端没包装"的孤儿命令。
  const handlerBody = handlerMatch[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  const registered = new Set(
    [...handlerBody.matchAll(/\b(ping|reflect_\w+)\b/g)].map((m) => m[1]),
  );

  // 1a. 注册了但前端没有消费面 —— AGENTS.md 定义的"半接线"。
  const frontendFiles = readdirSync(join(ROOT, 'src/utils/commands')).filter((f) => f.endsWith('.ts'));
  const frontendSrc = frontendFiles.map((f) => read(`src/utils/commands/${f}`)).join('\n');
  const frontendCommands = new Set(
    [...frontendSrc.matchAll(/export (?:async )?function (ping|reflect_\w+)/g)].map((m) => m[1]),
  );
  const orphans = [...registered].filter((c) => !frontendCommands.has(c)).sort();
  if (orphans.length === 0) {
    pass('registry-no-orphan', `${registered.size} 个已注册命令全部有前端消费面`);
  } else {
    fail('registry-no-orphan', `已注册但前端无包装:${orphans.join(', ')}`);
  }

  // 1b. 后端实现了但没注册 —— 命令体是死代码。
  const unregistered = [...backendCommands].filter((c) => !registered.has(c)).sort();
  if (unregistered.length === 0) {
    pass('backend-all-registered', `${backendCommands.size} 个后端命令体全部已注册`);
  } else {
    fail('backend-all-registered', `实现存在但未注册:${unregistered.join(', ')}`);
  }

  // 1c. 前端包装了但后端没有 —— 前端会拿到"未知命令"。
  const phantom = [...frontendCommands].filter((c) => !backendCommands.has(c) && c !== 'ping').sort();
  if (phantom.length === 0) {
    pass('frontend-no-phantom', `${frontendCommands.size} 个前端包装全部有后端实现`);
  } else {
    fail('frontend-no-phantom', `前端包装无后端实现:${phantom.join(', ')}`);
  }

  // 1d. 第四方:测试替身(fakeBackend)也得实现每条已注册命令。
  // 少一条 → 前端用例跑那条命令时会"静默失败"(mock invoke 抛错),
  // 应用级测试的覆盖就成了自说自话。
  const fakePath = 'tests/helpers/fakeBackend.ts';
  const fakeSrc = existsSync(join(ROOT, fakePath)) ? read(fakePath) : '';
  const fakeHandled = new Set(
    [...fakeSrc.matchAll(/handle\(\s*'(ping|reflect_\w+)'/g)].map((m) => m[1]),
  );
  const fakeMissing = [...registered].filter((c) => !fakeHandled.has(c)).sort();
  if (fakeSrc === '') {
    skip('fakebackend-parity', `${fakePath} 不存在 —— 跳过测试替身一致性检查`);
  } else if (fakeMissing.length === 0) {
    pass('fakebackend-parity', `fakeBackend 实现了全部 ${registered.size} 个已注册命令`);
  } else {
    fail('fakebackend-parity', `fakeBackend 缺少 handler:${fakeMissing.join(', ')}`);
  }

  // 1e. 命令面规模不倒退(只增不减)。
  if (registered.size >= 105) {
    pass('registry-size-floor', `注册表 ${registered.size} 个命令(下限 105)`);
  } else {
    fail('registry-size-floor', `注册表仅 ${registered.size} 个命令,低于下限 105`);
  }

  // 1f. 线格式契约样本完整:每条已注册命令在 tests/contracts/payloads.json
  // 里都有一份样本,且样本表里没有已删除命令的残留。样本被 L2(fakeBackend
  // 必须接受)与 L3(真后端必须反序列化)同时消费 —— 缺样本的命令等于没被
  // 跨运行时契约盯住。
  const payloadsPath = 'tests/contracts/payloads.json';
  if (!existsSync(join(ROOT, payloadsPath))) {
    fail('payload-sample-complete', `${payloadsPath} 不存在`);
  } else {
    let sampled = new Set();
    try {
      sampled = new Set(Object.keys(JSON.parse(read(payloadsPath)).commands ?? {}));
    } catch (e) {
      fail('payload-sample-complete', `${payloadsPath} 解析失败:${e.message}`);
    }
    const reflectRegistered = [...registered].filter((c) => c.startsWith('reflect_'));
    const noSample = reflectRegistered.filter((c) => !sampled.has(c)).sort();
    const stale = [...sampled].filter((c) => !registered.has(c)).sort();
    if (sampled.size > 0 && noSample.length === 0 && stale.length === 0) {
      pass('payload-sample-complete', `${sampled.size} 条命令全部有线格式契约样本`);
    } else if (sampled.size > 0) {
      const parts = [];
      if (noSample.length) parts.push(`缺样本:${noSample.join(', ')}`);
      if (stale.length) parts.push(`样本指向已删除命令:${stale.join(', ')}`);
      fail('payload-sample-complete', parts.join(';'));
    }
  }
}

// ── 2. 协议文档覆盖率(棘轮)────────────────────────────────────────────────
const bridgeDoc = read('docs/PROTOCOL_BRIDGE.md');
const undocumented = [...backendCommands].filter((c) => !bridgeDoc.includes(c));
const coverage = backendCommands.size === 0 ? 0 : 1 - undocumented.length / backendCommands.size;
const coveragePct = (coverage * 100).toFixed(1);

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(read('tests/static/baseline.json')) : {};
const docFloor = baseline['protocol-doc-coverage'] ?? 0;

if (coverage >= docFloor) {
  pass('protocol-doc-coverage', `PROTOCOL_BRIDGE 覆盖 ${coveragePct}%(下限 ${(docFloor * 100).toFixed(1)}%)`);
} else {
  fail(
    'protocol-doc-coverage',
    `PROTOCOL_BRIDGE 覆盖 ${coveragePct}% < 基线 ${(docFloor * 100).toFixed(1)}%;未记录:${undocumented.slice(0, 8).join(', ')}`,
  );
}

// ── 3. 路由 ↔ 视图文件存在性 ───────────────────────────────────────────────
const routerSrc = read('src/router.tsx');
const aliasImports = new Map();
for (const m of routerSrc.matchAll(/import\s+\{([^}]+)\}\s+from\s+'@\/([^']+)'/g)) {
  for (const raw of m[1].split(',')) {
    const name = raw.trim().split(/\s+as\s+/).pop().trim();
    if (name) aliasImports.set(name, `src/${m[2]}`);
  }
}
const routeComponents = new Set(
  [...routerSrc.matchAll(/component:\s*([A-Z]\w*)/g)].map((m) => m[1]),
);
const missingViews = [];
for (const comp of routeComponents) {
  const base = aliasImports.get(comp);
  if (!base) continue; // 内联组件(非 @/ 别名)跳过
  const candidates = [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`];
  if (!candidates.some((c) => existsSync(join(ROOT, c)))) missingViews.push(`${comp} → ${base}`);
}
if (routeComponents.size === 0) {
  fail('route-view-exists', 'router.tsx 里解析不到任何路由组件');
} else if (missingViews.length === 0) {
  pass('route-view-exists', `${routeComponents.size} 个路由组件全部有对应文件`);
} else {
  fail('route-view-exists', `路由组件文件缺失:${missingViews.join(', ')}`);
}

// ── 4. 生产文件大小预算(棘轮)──────────────────────────────────────────────
const MAX_LINES = 500;
const prodFiles = [
  ...walk('src', (p) => /\.[jt]sx?$/.test(p)),
  ...walk('src-tauri/src', (p) => p.endsWith('.rs')),
  ...walk('app-core/src', (p) => p.endsWith('.rs')),
].filter(isProdSource);

const oversized = [];
for (const f of prodFiles) {
  const lines = countLines(read(f));
  if (lines > MAX_LINES) oversized.push(`${f}(${lines})`);
}
const knownOversized = new Set(baseline['file-size-budget'] ?? []);
const newOversized = oversized.filter((f) => !knownOversized.has(f.split('(')[0]));
if (newOversized.length === 0) {
  pass(
    'file-size-budget',
    `无新增超 ${MAX_LINES} 行文件(存量 ${oversized.length} 个已登记基线)`,
  );
} else {
  fail('file-size-budget', `新增超预算文件:${newOversized.join(', ')}`);
}

// ── 5. 调试残留 ───────────────────────────────────────────────────────────
const debugHits = [];
for (const f of prodFiles) {
  const src = read(f);
  const patterns = f.endsWith('.rs')
    ? [/\bdbg!\(/, /\btodo!\(/, /\bunimplemented!\(/]
    : [/\bconsole\.log\(/, /\bdebugger\b/];
  for (const p of patterns) {
    if (p.test(src)) {
      const line = src.split('\n').findIndex((l) => p.test(l)) + 1;
      debugHits.push(`${f}:${line}`);
    }
  }
}
if (debugHits.length === 0) {
  pass('no-debug-leftover', `${prodFiles.length} 个生产文件无调试残留`);
} else {
  fail('no-debug-leftover', `调试残留:${debugHits.join(', ')}`);
}

// ── 6. i18n 命名空间全部合并 ──────────────────────────────────────────────
const stringsDir = 'src/utils/i18n/strings';
const namespaces = readdirSync(join(ROOT, stringsDir))
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  .map((f) => f.replace(/\.ts$/, ''));
const stringsIndex = read(`${stringsDir}/index.ts`);
const unmerged = namespaces.filter((ns) => !new RegExp(`\\b${ns}\\b`).test(stringsIndex));
if (unmerged.length === 0) {
  pass('i18n-namespace-merged', `${namespaces.length} 个命名空间全部并入 STRINGS`);
} else {
  fail('i18n-namespace-merged', `未并入 STRINGS 的命名空间:${unmerged.join(', ')}`);
}

// ── 7. 前端命令 barrel 完整 ───────────────────────────────────────────────
const cmdBarrel = read('src/utils/commands/index.ts');
const domainFiles = readdirSync(join(ROOT, 'src/utils/commands'))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.spec.ts') && f !== 'index.ts')
  .map((f) => f.replace(/\.ts$/, ''));
const notExported = domainFiles.filter((d) => !cmdBarrel.includes(`'./${d}'`));
if (notExported.length === 0) {
  pass('commands-barrel-complete', `${domainFiles.length} 个领域模块全部从 barrel 导出`);
} else {
  fail('commands-barrel-complete', `未从 barrel 导出:${notExported.join(', ')}`);
}

// ── 8. 硬编码密钥 ─────────────────────────────────────────────────────────
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{16,}['"]/i,
];
const secretHits = [];
for (const f of prodFiles) {
  const src = read(f);
  for (const p of SECRET_PATTERNS) {
    if (p.test(src)) secretHits.push(f);
  }
}
if (secretHits.length === 0) {
  pass('no-hardcoded-secret', '生产源码未发现硬编码密钥');
} else {
  fail('no-hardcoded-secret', `疑似硬编码密钥:${[...new Set(secretHits)].join(', ')}`);
}

// ── 9. 真后端测试源码引用的命令数(棘轮)──────────────────────────────────
// 只统计字符串引用，不证明用例执行、命令成功或行为语义覆盖。
const capDir = join(ROOT, 'src-tauri', 'tests');
let capInvoked = new Set();
if (existsSync(capDir)) {
  const scan = (path) => {
    const src = readFileSync(path, 'utf8');
    for (const m of src.matchAll(/"(reflect_\w+)"/g)) capInvoked.add(m[1]);
  };
  for (const f of readdirSync(capDir)) {
    // `ipc_*.rs` 包含能力层、契约和实模型测试。
    if (f.startsWith('ipc_') && f.endsWith('.rs')) {
      scan(join(capDir, f));
    }
  }
  // `common/mod.rs` 是共享夹具 —— 它也驱动命令(工作区切换),一并计入。
  const harness = join(capDir, 'common', 'mod.rs');
  if (existsSync(harness)) scan(harness);
}
const capCovered = [...capInvoked].filter((c) => backendCommands.has(c));
const capFloor = baseline['capability-command-coverage'] ?? 0;
if (capCovered.length >= capFloor) {
  pass(
    'capability-command-coverage',
    `后端测试源码引用 ${capCovered.length}/${backendCommands.size} 条命令(下限 ${capFloor};非执行覆盖)`,
  );
} else {
  fail(
    'capability-command-coverage',
    `能力覆盖层命令覆盖跌到 ${capCovered.length} < 基线 ${capFloor}`,
  );
}

// ── 9b. 已完成命令必须有测试引用或显式环境排除 ─────────────────────────
// 字符串引用不等于行为通过,但“从未被任何后端测试引用”能机械发现
// 已完成命令完全没有测试入口的情况。排除项必须写明环境原因。
let commandTestExclusions = {};
try {
  commandTestExclusions = JSON.parse(read('tests/command-test-exclusions.json')).commands ?? {};
} catch (error) {
  fail('registered-command-test-exclusions', `排除表无法解析:${error.message}`);
}
for (const [command, exclusion] of Object.entries(commandTestExclusions)) {
  if (!backendCommands.has(command)) {
    fail('registered-command-test-exclusions', `排除项指向不存在的命令:${command}`);
  }
  if (!exclusion || typeof exclusion.reason !== 'string' || exclusion.reason.trim() === '') {
    fail('registered-command-test-exclusions', `排除项缺少原因:${command}`);
  }
}
const untestedCommands = [...backendCommands]
  .filter(
    (cmd) =>
      !capInvoked.has(cmd) &&
      !commandUnitTested.has(cmd) &&
      !(cmd in commandTestExclusions),
  )
  .sort();
if (untestedCommands.length === 0) {
  pass(
    'registered-command-has-test',
    `${backendCommands.size} 条命令均有测试引用或显式环境排除`,
  );
} else {
  fail(
    'registered-command-has-test',
    `已完成命令无测试引用:${untestedCommands.join(', ')}`,
  );
}

// ── 输出 ───────────────────────────────────────────────────────────────────
// 参数解析:非 flag 的第一个位置参数是输出文件;`--write-baseline` 是开关。
// (早先直接把 argv[2] 当输出路径,`--write-baseline` 会被写成一个名为
//  `--write-baseline` 的文件 —— 踩过,别再踩。)
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const outPath = positional[0];
const writeBaseline = flags.has('--write-baseline');

if (writeBaseline) {
  // 生成棘轮基线:把当前存量登记下来,之后**新增**违规才会失败。
  const { writeFileSync } = await import('node:fs');
  const baseline = {
    'protocol-doc-coverage': Number(coverage.toFixed(4)),
    'file-size-budget': oversized.map((f) => f.split('(')[0]).sort(),
    'capability-command-coverage': capCovered.length,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  process.stdout.write(`基线已写入 ${relative(ROOT, BASELINE_PATH)}\n`);
}

const lines = results.map((r) =>
  r.reason ? `${r.status}\t${r.name}\t${r.reason}` : `${r.status}\t${r.name}`,
);
const text = lines.join('\n') + '\n';
if (outPath) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(resolveOut(outPath), text);
} else {
  process.stdout.write(text);
}
process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);

/**
 * TianYuanFood 子站构建脚本
 *
 * 作用：
 * 1. （如需要）安装 TianYuanFood 依赖
 * 2. 以 /tianyuanFood 为 base 构建 React 单页应用
 * 3. 将产物同步到 public/tianyuanFood/，随 Astro 一起输出
 *
 * 用法：
 *   node scripts/build-tianyuan.mjs                 # 常规构建（astro build 前自动执行）
 *   node scripts/build-tianyuan.mjs --if-missing    # 仅在产物不存在时构建（dev 启动时使用）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SUB = path.join(ROOT, 'TianYuanFood');
const DIST = path.join(SUB, 'dist');
const OUT = path.join(ROOT, 'public', 'tianyuanFood');
const BASE = '/tianyuanFood/';

const ifMissing = process.argv.includes('--if-missing');
if (ifMissing && fs.existsSync(path.join(OUT, 'index.html'))) {
  console.log('[tianyuan] 产物已存在，跳过构建（如需强制重建请运行 npm run build:tianyuan）');
  process.exit(0);
}

if (!fs.existsSync(SUB)) {
  console.error(`[tianyuan] 未找到子项目目录：${SUB}`);
  process.exit(1);
}

function run(cmd, args, cwd) {
  console.log(`[tianyuan] ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd,
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  if (result.status !== 0) {
    console.error(`[tianyuan] 命令失败（exit ${result.status}）：${cmd} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

// 1. 依赖检查：本地有 node_modules/vite 才跳过安装
const hasVite = fs.existsSync(path.join(SUB, 'node_modules', '.bin'));
if (!hasVite) {
  console.log('[tianyuan] 安装子项目依赖…');
  run('npm', ['install', '--no-audit', '--no-fund'], SUB);
}

// 2. 以 /tianyuanFood 为 base 构建
run('npm', ['run', 'build', '--', `--base=${BASE}`], SUB);

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('[tianyuan] 构建完成但未找到 dist/index.html');
  process.exit(1);
}

// 3. 同步产物到 public/tianyuanFood/
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(DIST, OUT, { recursive: true });
console.log(`[tianyuan] 已同步到 ${path.relative(ROOT, OUT)}，访问地址 ${BASE}`);

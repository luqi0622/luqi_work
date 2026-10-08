/**
 * 时序波形图 —— 纯逻辑层统一出口
 *
 * 注意：ui.ts 与 persist.ts 有 DOM 依赖，故意不在这里导出，
 * 避免 node 侧测试误引。
 */
export * from './types';
export * from './model';
export * from './render';
export * from './preset';

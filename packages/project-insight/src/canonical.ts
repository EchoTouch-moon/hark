/**
 * @fileoverview 规范化 JSON 序列化与哈希工具
 *
 * 用于保证事件指纹、规则去重键（insightDedupKey）在不同运行环境下的完全确定性与不可篡改性。
 */

import { createHash } from 'node:crypto';

/**
 * 确定性 JSON 序列化
 *
 * 对对象所有键名按字典序排序，无额外空白字符，递归处理数组与嵌套对象。
 */
export function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalSerialize(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalSerialize(record[key])}`).join(',')}}`;
}

/**
 * 计算输入字符串的 SHA-256 十六进制摘要
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * 计算洞察去重键（insightDedupKey）
 *
 * 绑定 projectId、ruleId、ruleMajorVersion、subjectKey 与 episodeKey。
 */
export function insightDedupKey(input: {
  projectId: string;
  ruleId: string;
  ruleMajorVersion: number;
  subjectKey: string;
  episodeKey: string;
}): string {
  return sha256Hex(
    canonicalSerialize({
      episodeKey: input.episodeKey,
      projectId: input.projectId,
      ruleId: input.ruleId,
      ruleMajorVersion: input.ruleMajorVersion,
      subjectKey: input.subjectKey,
    }),
  );
}

/**
 * @fileoverview 本地执行器（MockExecutor）
 * 仅在指定的 demo-artifacts 根目录下进行真实的本地文件落盘（绝不触碰用户真实目录），
 * 生成带有时间戳与内容哈希的真实产物，供独立的 Verifier 验证。
 * 同时记录 RunStep 步骤并模拟短延时，驱动前端交互动效。
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActionSpec, FailureClass, RunStep, TaskRun } from '@hearth/contracts';
import { sha256Hex } from '@hearth/contracts';
import type { Storage } from '@hearth/storage';
import { resolveArtifactPath } from '../policy/artifact-path.js';

/** 执行器产出结果 */
export interface ExecutorResult {
  /** 是否执行成功并生成有效产物 */
  ok: boolean;
  /** 产物相对于 demoRoot 的相对路径 */
  artifactRelPath?: string;
  /** 产物文件的真实 SHA-256 哈希值 */
  sha256?: string;
  /** 失败归类 */
  failureClass?: FailureClass;
  /** 错误描述信息 */
  error?: string;
}

/** 执行器依赖配置 */
export interface ExecutorDeps {
  /** 专用演示产物存放根目录绝对路径 */
  artifactRoot: string;
  /** 持久化存储实例 */
  storage: Storage;
  /** 统一时间戳生成器 */
  clock: () => string;
  /** 单步骤执行延时（毫秒，默认 90ms） */
  stepDelayMs?: number;
}

/**
 * 本地安全演示执行器
 * 在受控 demo-artifacts 根目录中执行真实的本地写入
 */
export class MockExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  async execute(opts: {
    runId: string;
    spec: ActionSpec;
    isCancelled: () => Promise<boolean>;
  }): Promise<ExecutorResult> {
    const { runId, spec } = opts;
    const delay = this.deps.stepDelayMs ?? 90;
    try {
      const plan = this.planSteps(spec);
      let seq = 0;
      for (const name of plan.prepare) {
        if (await opts.isCancelled()) return this.cancelled();
        await this.runStep(runId, seq++, name, delay);
      }

      const rel = spec.verification.artifactPath;
      if (!rel) return { ok: false, failureClass: 'policy', error: 'no artifactPath' };
      const resolved = resolveArtifactPath(this.deps.artifactRoot, rel);
      if (!resolved.ok) return { ok: false, failureClass: 'policy', error: resolved.reason };

      if (await opts.isCancelled()) return this.cancelled();

      const content = this.renderArtifact(spec);
      await mkdir(path.dirname(resolved.absPath), { recursive: true });
      await writeFile(resolved.absPath, content, 'utf8');
      const hash = sha256Hex(content);

      await this.runStep(runId, seq++, plan.writeStep, delay, `wrote ${rel} (${content.length} bytes)`);
      return { ok: true, artifactRelPath: resolved.relPath, sha256: hash };
    } catch (err) {
      return { ok: false, failureClass: 'executor', error: String(err) };
    }
  }

  private cancelled(): ExecutorResult {
    return { ok: false, failureClass: 'unknown', error: 'cancelled' };
  }

  private async runStep(runId: string, seq: number, name: string, delayMs: number, detail?: string): Promise<void> {
    const startedAt = this.deps.clock();
    const step: RunStep = { id: `step-${runId}-${seq}`, runId, sequence: seq, name, status: 'running', startedAt };
    this.deps.storage.addStep(step);
    await sleep(delayMs);
    this.deps.storage.updateStep(step.id, 'succeeded', this.deps.clock(), detail);
  }

  private planSteps(spec: ActionSpec): { prepare: string[]; writeStep: string } {
    switch (spec.actionType) {
      case 'report.generate':
        return { prepare: ['diagnose.read_event', 'diagnose.summarize_failures'], writeStep: 'report.write_json' };
      case 'checklist.generate':
        return { prepare: ['study.read_plan', 'checklist.compose'], writeStep: 'checklist.write_md' };
      case 'draft.generate':
        return { prepare: ['calendar.read_conflict', 'draft.compose'], writeStep: 'draft.write_md' };
      case 'repo.read_diagnose':
        return { prepare: ['fixture.read'], writeStep: 'diagnose.readback' };
    }
  }

  private renderArtifact(spec: ActionSpec): string {
    const stamp = this.deps.clock();
    const base = {
      contractVersion: '1',
      generatedAt: stamp,
      runRef: spec.idempotencyKey.slice(0, 12),
      projectId: spec.projectId,
      actionType: spec.actionType,
      note: '合成演示数据 · 由 MockExecutor 生成',
    };
    switch (spec.actionType) {
      case 'report.generate': {
        const findings = [
          { severity: 'error', component: 'synthetic-build', message: '1 个合成测试断言失败（示例）' },
          { severity: 'warn', component: 'lint', message: '2 个合成告警（示例）' },
        ];
        return JSON.stringify({ ...base, kind: 'ci-diagnosis', findings, verdict: 'synthetic-failure', params: spec.params }, null, 2);
      }
      case 'checklist.generate':
        return [
          `# 实验清单（${spec.projectId}）`,
          '',
          `- 生成时间：${stamp}`,
          '- [ ] 复现失败用例并记录基线',
          '- [ ] 检索相关文献 3 篇并做摘记',
          '- [ ] 跑一轮小规模消融并归档结果',
          '',
          '> 合成演示内容，仅写入 demo-artifacts。',
          '',
        ].join('\n');
      case 'draft.generate':
        return [
          `# 会议调整草稿（${spec.projectId}）`,
          '',
          `生成时间：${stamp}`,
          '',
          '两位好，',
          '',
          '我这边两个时段撞车了，想把本周的同步挪到更合适的Slot；下面是我建议的两个备选时间：',
          '',
          '1. 原时段前移 30 分钟',
          '2. 顺延到次日上午',
          '',
          '请回复偏好；这只是本地草稿，不会发送任何邮件。',
          '',
        ].join('\n');
      case 'repo.read_diagnose':
        return JSON.stringify({ ...base, kind: 'read-diagnosis' }, null, 2);
    }
  }
}

export function sha256FileContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { TaskRun };

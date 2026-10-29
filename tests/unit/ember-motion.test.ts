import { describe, expect, it } from 'vitest';
import { gsap } from 'gsap';
import {
  HEARTH_EASE,
  STAGE_TRANSITION_DURATION,
  STOKE_SURGE_RISE,
  STOKE_SURGE_DECAY,
  COMPOSER_FLIP_DURATION,
  STAGE_TARGETS,
  createFlameMotionController,
} from '../../apps/web/src/motion';
import type { ProjectFlameStage } from '../../apps/web/src/features/projectEmber';

describe('Hearth GSAP 动效系统 (ember-motion)', () => {
  describe('缓动与时间令牌规范 (HEARTH_EASE & Duration Tokens)', () => {
    it('导出符合规范的所有缓动曲线定义', () => {
      expect(HEARTH_EASE.gentle).toBe('sine.inOut');
      expect(HEARTH_EASE.breath).toBe('power1.inOut');
      expect(HEARTH_EASE.burst).toBe('power2.out');
      expect(HEARTH_EASE.snap).toBe('power3.out');
      expect(HEARTH_EASE.sharp).toBe('power2.inOut');
      expect(HEARTH_EASE.recoil).toBe('back.out(1.4)');
    });

    it('导出标准时序物理常量', () => {
      expect(STAGE_TRANSITION_DURATION).toBe(1.2);
      expect(STOKE_SURGE_RISE).toBe(0.22);
      expect(STOKE_SURGE_DECAY).toBe(1.35);
      expect(COMPOSER_FLIP_DURATION).toBe(0.4);
    });
  });

  describe('五大火焰生命状态目标参数 (STAGE_TARGETS)', () => {
    it('包含规范规定的 spark, sprout, blaze, golden, dormant 基准参数', () => {
      expect(STAGE_TARGETS.spark).toEqual({
        heat: 0.20,
        size: 0.90,
        golden: 0.0,
        dormant: 0.0,
        sparks: 8,
      });

      expect(STAGE_TARGETS.sprout).toEqual({
        heat: 0.45,
        size: 1.00,
        golden: 0.0,
        dormant: 0.0,
        sparks: 16,
      });

      expect(STAGE_TARGETS.blaze).toEqual({
        heat: 0.75,
        size: 1.15,
        golden: 0.0,
        dormant: 0.0,
        sparks: 32,
      });

      expect(STAGE_TARGETS.golden).toEqual({
        heat: 0.95,
        size: 1.25,
        golden: 1.0,
        dormant: 0.0,
        sparks: 48,
      });

      expect(STAGE_TARGETS.dormant).toEqual({
        heat: 0.10,
        size: 0.70,
        golden: 0.0,
        dormant: 1.0,
        sparks: 2,
      });
    });
  });

  describe('五大生命阶段平滑流转 (transitionToStage)', () => {
    const stages: ProjectFlameStage[] = ['spark', 'sprout', 'blaze', 'golden', 'dormant'];

    for (const stage of stages) {
      it(`平滑插值到 ${stage} 目标参数 (虚拟时间 1.2s seek)`, () => {
        const controller = createFlameMotionController({
          heat: 0,
          size: 0,
          golden: 0,
          dormant: 0,
        });

        const timeline = controller.transitionToStage(stage);
        timeline.pause();

        // 初始时刻 t = 0
        timeline.seek(0);
        expect(controller.frame.heat).toBe(0);
        expect(controller.frame.size).toBe(0);

        // 快进至终点 t = 1.2s
        timeline.seek(STAGE_TRANSITION_DURATION);
        const target = STAGE_TARGETS[stage];
        expect(controller.frame.heat).toBeCloseTo(target.heat, 4);
        expect(controller.frame.size).toBeCloseTo(target.size, 4);
        expect(controller.frame.golden).toBeCloseTo(target.golden, 4);
        expect(controller.frame.dormant).toBeCloseTo(target.dormant, 4);

        controller.dispose();
      });
    }

    it('immediate: true 时立即就位目标参数无需快进', () => {
      const controller = createFlameMotionController({
        heat: 0.1,
        size: 0.5,
        golden: 0,
        dormant: 0,
      });

      controller.transitionToStage('blaze', { immediate: true });
      expect(controller.frame.heat).toBe(STAGE_TARGETS.blaze.heat);
      expect(controller.frame.size).toBe(STAGE_TARGETS.blaze.size);
      expect(controller.frame.golden).toBe(STAGE_TARGETS.blaze.golden);
      expect(controller.frame.dormant).toBe(STAGE_TARGETS.blaze.dormant);

      controller.dispose();
    });

    it('中途流转满足 C1 连续性与半程平滑性', () => {
      const controller = createFlameMotionController({
        heat: STAGE_TARGETS.spark.heat, // 0.20
        size: STAGE_TARGETS.spark.size, // 0.90
        golden: 0,
        dormant: 0,
      });

      const timeline = controller.transitionToStage('blaze');
      timeline.pause();

      // 半程 t = 0.6s: sine.inOut 在中间点严格为 0.5 进度
      timeline.seek(STAGE_TRANSITION_DURATION / 2);
      const expectedHeat = (STAGE_TARGETS.spark.heat + STAGE_TARGETS.blaze.heat) / 2; // (0.2 + 0.75)/2 = 0.475
      expect(controller.frame.heat).toBeCloseTo(expectedHeat, 3);

      controller.dispose();
    });
  });

  describe('添柴激荡时间线 (triggerStokeSurge)', () => {
    it('在 t=0 保持基准，在 t=0.22s 达到爆发峰值并在 t=1.57s 完全回落归零', () => {
      const controller = createFlameMotionController();
      const timeline = controller.triggerStokeSurge(0.55);
      timeline.pause();

      // t = 0
      timeline.seek(0);
      expect(controller.frame.surge).toBe(0);

      // t = 0.22s (爆发峰值)
      timeline.seek(STOKE_SURGE_RISE);
      expect(controller.frame.surge).toBeCloseTo(0.55, 3);

      // t = 0.8s (衰减阶段中途)
      timeline.seek(0.8);
      expect(controller.frame.surge).toBeGreaterThan(0);
      expect(controller.frame.surge).toBeLessThan(0.55);

      // t = 1.57s (完整衰减归零)
      timeline.seek(STOKE_SURGE_RISE + STOKE_SURGE_DECAY);
      expect(controller.frame.surge).toBe(0);

      controller.dispose();
    });

    it('支持自定义 intensity 强度', () => {
      const controller = createFlameMotionController();
      const timeline = controller.triggerStokeSurge(0.8);
      timeline.pause();

      timeline.seek(STOKE_SURGE_RISE);
      expect(controller.frame.surge).toBeCloseTo(0.8, 3);

      timeline.seek(STOKE_SURGE_RISE + STOKE_SURGE_DECAY);
      expect(controller.frame.surge).toBe(0);

      controller.dispose();
    });
  });

  describe('输入微脉冲时间线 (triggerPulse)', () => {
    it('gentle 与 strong 脉冲在 0.32s 达到不同峰值并在 1.12s 衰减归零', () => {
      const controller = createFlameMotionController();

      const tlGentle = controller.triggerPulse('gentle');
      tlGentle.pause();
      tlGentle.seek(0.32);
      expect(controller.frame.pulse).toBeCloseTo(0.20, 2);
      tlGentle.seek(1.12);
      expect(controller.frame.pulse).toBe(0);

      const tlStrong = controller.triggerPulse('strong');
      tlStrong.pause();
      tlStrong.seek(0.32);
      expect(controller.frame.pulse).toBeCloseTo(0.35, 2);
      tlStrong.seek(1.12);
      expect(controller.frame.pulse).toBe(0);

      controller.dispose();
    });
  });

  describe('等待思索呼吸波 (triggerWaiting)', () => {
    it('开启时形成 repeat: -1, yoyo: true 的往复循环波', () => {
      const controller = createFlameMotionController();
      const timeline = controller.triggerWaiting(true);
      timeline.pause();

      expect(timeline.repeat()).toBe(-1);
      expect(timeline.yoyo()).toBe(true);

      // 周期 t = 0 -> 0.0
      timeline.seek(0);
      expect(controller.frame.waiting).toBe(0);

      // 半周期 t = 1.8s -> 达到最大微光 0.16
      timeline.seek(1.8);
      expect(controller.frame.waiting).toBeCloseTo(0.16, 3);

      // 全周期 t = 3.6s -> yoyo 翻转回落至 0.0
      timeline.seek(3.6);
      expect(controller.frame.waiting).toBeCloseTo(0, 3);

      // 第二轮半周期 t = 5.4s -> 再次升至 0.16
      timeline.seek(5.4);
      expect(controller.frame.waiting).toBeCloseTo(0.16, 3);

      controller.dispose();
    });

    it('关闭等待态时生成重置动画并平滑归零', () => {
      const controller = createFlameMotionController({ waiting: 0.16 });
      const timeline = controller.triggerWaiting(false);
      timeline.pause();

      timeline.seek(0.3);
      expect(controller.frame.waiting).toBe(0);

      controller.dispose();
    });
  });

  describe('内存管理与资源释放 (dispose)', () => {
    it('调用 dispose() 后彻底杀死 frame 上的所有活动 Tween 与时间线', () => {
      const controller = createFlameMotionController();

      // 同时启动多个补间与循环时间线
      controller.transitionToStage('blaze');
      controller.triggerStokeSurge();
      controller.triggerWaiting(true);
      controller.triggerPulse('strong');

      // 验证存在正在执行的 tweens
      const activeTweensBefore = gsap.getTweensOf(controller.frame);
      expect(activeTweensBefore.length).toBeGreaterThan(0);

      // 执行终极清理
      controller.dispose();

      // 严格断言：所有针对 frame 的补间已被彻底销毁
      const activeTweensAfter = gsap.getTweensOf(controller.frame);
      expect(activeTweensAfter.length).toBe(0);
    });

    it('多次调用 dispose() 安全幂等不抛错', () => {
      const controller = createFlameMotionController();
      expect(() => {
        controller.dispose();
        controller.dispose();
      }).not.toThrow();
    });
  });
});

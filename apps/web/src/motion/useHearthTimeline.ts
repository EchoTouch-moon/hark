import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import type { DependencyList, RefObject } from 'react';

gsap.registerPlugin(useGSAP);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ContextSafeFunc = <T extends (...args: any[]) => any>(func: T) => T;

export type HearthTimelineCallback = (
  context: gsap.Context,
  contextSafe?: ContextSafeFunc
) => (() => void) | void;

export interface HearthTimelineConfig {
  scope?: RefObject<HTMLElement | null> | HTMLElement | string;
  dependencies?: DependencyList;
  revertOnUpdate?: boolean;
}

export interface UseHearthTimelineReturn {
  context: gsap.Context;
  contextSafe: ContextSafeFunc;
}

/**
 * Encapsulates `@gsap/react` `useGSAP` with scoped execution,
 * `revertOnUpdate: true` defaults, `contextSafe` asynchronous callback wrapper,
 * and automatic revert/cleanup on component unmount.
 *
 * Specification: docs/MOTION-SPECIFICATION.md §6.1 & §6.2
 */
export function useHearthTimeline(
  callbackOrConfig?: HearthTimelineCallback | HearthTimelineConfig,
  configOrDeps?: HearthTimelineConfig | DependencyList
): UseHearthTimelineReturn {
  let callback: HearthTimelineCallback | undefined;
  let config: HearthTimelineConfig = { revertOnUpdate: true };

  if (typeof callbackOrConfig === 'function') {
    callback = callbackOrConfig;
    if (Array.isArray(configOrDeps)) {
      config = { dependencies: configOrDeps, revertOnUpdate: true };
    } else if (configOrDeps && typeof configOrDeps === 'object') {
      config = {
        revertOnUpdate: true,
        ...configOrDeps,
      };
    }
  } else if (callbackOrConfig && typeof callbackOrConfig === 'object') {
    config = {
      revertOnUpdate: true,
      ...callbackOrConfig,
    };
  }

  const gsapConfig = {
    scope: config.scope,
    dependencies: config.dependencies ? Array.from(config.dependencies) : undefined,
    revertOnUpdate: config.revertOnUpdate,
  };

  if (callback) {
    return useGSAP(callback, gsapConfig);
  }
  return useGSAP(gsapConfig);
}

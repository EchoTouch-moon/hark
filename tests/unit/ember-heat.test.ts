import { it, expect } from 'vitest';
import { computeEmberHeat, latestConfirmedInteraction } from '../../apps/web/src/features/emberHeat';
const now = Date.parse('2026-10-30T00:00:00Z');
const at = (hours: number) => new Date(now - hours * 3600000).toISOString();
it('初见没有虚假历史', () => expect(computeEmberHeat({nowMs:now})).toMatchObject({band:'cool',reason:'no-interaction',greeting:'从这里开始。'}));
it.each([[24,'hot'],[24.001,'warm'],[168,'warm'],[168.001,'cool']] as const)('精确小时边界 %s', (hours, band) => expect(computeEmberHeat({lastConfirmedAt:at(hours),nowMs:now}).band).toBe(band));
it.each(['invalid', at(-1)])('不可信时间不加热 %s', timestamp => expect(computeEmberHeat({lastConfirmedAt:timestamp,nowMs:now})).toMatchObject({band:'cool',reason:'unknown-time'}));
it('只读已确认用户消息，排除乐观、助手、未来消息', () => {
 const messages=[{id:'u1',role:'user',createdAt:at(72)},{id:'a',role:'assistant',createdAt:at(0)},{id:'local-1',role:'user',createdAt:at(0)},{id:'u2',role:'user',createdAt:at(-1)}];
 expect(latestConfirmedInteraction(messages,now)).toBe(at(72));
});
it('十次连续互动封顶', () => expect(new Set(Array.from({length:10},(_,i)=>computeEmberHeat({lastConfirmedAt:at(i),nowMs:now}).heat)).size).toBe(1));

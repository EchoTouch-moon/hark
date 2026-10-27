import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ActionTypeSchema,
  CONTRACT_VERSION,
  EventSchema,
  RiskSchema,
  type ActionType,
  type Event,
  type Risk,
} from '@hearth/contracts';

/**
 * Fixture loader for the synthetic evaluation corpus (fixtures/*.json).
 *
 * Fixture files carry evaluation metadata (goldenAction / goldenUseful) next to
 * contract payloads. EventSchema is .strict(), so the metadata MUST be stripped
 * before parsing; the loader returns each entry as { event, meta } where `event`
 * is the pure contract object. All parsing uses safeParse and every failure is
 * aggregated into a single error that names the offending fixture id.
 */

export const EVENTS_FIXTURE = 'events.json';
export const PROJECTS_FIXTURE = 'projects.json';
export const ADVERSARIAL_FIXTURE = 'adversarial.json';
export const DEMO_WALKTHROUGH_FIXTURE = 'demo-walkthrough.json';

/** 攻击用例数量下限（S01..S12）。 */
export const MIN_ADVERSARIAL_CASES = 12;

/** 评测元数据：fixture 标注，不属于 Event 合同本体。 */
export interface EventFixtureMeta {
  goldenAction: string | null;
  goldenUseful: boolean;
}

export interface LoadedFixtureEvent {
  event: Event;
  meta: EventFixtureMeta;
}

export interface EventsFixture {
  contractVersion: string;
  fixtureClock: string;
  events: LoadedFixtureEvent[];
}

export interface ProjectFixture {
  id: string;
  name: string;
  description: string;
  visibility: string;
}

export interface ProjectsFixture {
  contractVersion: string;
  projects: ProjectFixture[];
}

export interface AdversarialCase {
  id: string;
  kind: string;
  input: unknown;
  expected: string;
}

export interface AdversarialFixture {
  contractVersion: string;
  cases: AdversarialCase[];
}

export interface DemoScenario {
  id: string;
  name: string;
  eventId: string;
  cardTitle: string;
  whyNow: string;
  actionType: ActionType;
  expectedArtifact: string;
  verification: string;
  risk: Risk;
}

export interface DemoWalkthroughFixture {
  contractVersion: string;
  scenarios: DemoScenario[];
}

export interface Fixtures {
  events: EventsFixture;
  projects: ProjectsFixture;
  adversarial: AdversarialFixture;
  demoWalkthrough: DemoWalkthroughFixture;
}

/** Aggregated fixture validation error; `issues` names the failing entries. */
export class FixtureValidationError extends Error {
  readonly issues: readonly string[];

  constructor(fixtureName: string, issues: readonly string[]) {
    const lines = issues.map((issue) => `  - ${issue}`).join('\n');
    super(`fixture ${fixtureName} is invalid:\n${lines}`);
    this.name = 'FixtureValidationError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function fail(fixtureName: string, issues: readonly string[]): never {
  throw new FixtureValidationError(fixtureName, issues);
}

function readFixtureJson(rootDir: string, fixtureName: string): unknown {
  const path = join(rootDir, 'fixtures', fixtureName);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new FixtureValidationError(fixtureName, [`cannot read ${path}: ${reason}`]);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new FixtureValidationError(fixtureName, [`${path} is not valid JSON: ${reason}`]);
  }
}

function requireRecordPayload(
  payload: unknown,
  fixtureName: string,
  issues: string[],
): payload is Record<string, unknown> {
  if (!isRecord(payload)) {
    issues.push('fixture root must be a JSON object');
    return false;
  }
  return true;
}

function requireContractVersion(payload: Record<string, unknown>, issues: string[]): void {
  if (payload.contractVersion !== CONTRACT_VERSION) {
    const got = JSON.stringify(payload.contractVersion) ?? 'undefined';
    issues.push(`contractVersion must be '${CONTRACT_VERSION}' but got ${got}`);
  }
}

/** 解析 events.json 载荷（纯函数，便于对错误聚合做单元测试）。 */
export function parseEventsPayload(payload: unknown): EventsFixture {
  const fixtureName = EVENTS_FIXTURE;
  const issues: string[] = [];
  if (!requireRecordPayload(payload, fixtureName, issues)) fail(fixtureName, issues);
  const root = payload;
  requireContractVersion(root, issues);

  const fixtureClock = root.fixtureClock;
  if (!isNonEmptyString(fixtureClock)) {
    issues.push('fixtureClock must be a non-empty ISO datetime string');
    fail(fixtureName, issues);
  }

  const rawEvents = root.events;
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
    issues.push('events must be a non-empty array');
    fail(fixtureName, issues);
  }

  const events: LoadedFixtureEvent[] = [];
  rawEvents.forEach((rawEvent, index) => {
    if (!isRecord(rawEvent)) {
      issues.push(`events[${index}] must be an object`);
      return;
    }
    const id = isNonEmptyString(rawEvent.id) ? rawEvent.id : `<missing id at index ${index}>`;
    // EventSchema 是 strict 的：先剥离评测元数据再交给合同解析。
    const { goldenAction, goldenUseful, ...eventFields } = rawEvent;
    const parsed = EventSchema.safeParse(eventFields);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      issues.push(`events[${index}] (id=${id}) failed EventSchema: ${details}`);
      return;
    }
    if (goldenAction !== null && !isNonEmptyString(goldenAction)) {
      issues.push(`events[${index}] (id=${id}) meta goldenAction must be an action type or null`);
      return;
    }
    if (typeof goldenUseful !== 'boolean') {
      issues.push(`events[${index}] (id=${id}) meta goldenUseful must be a boolean`);
      return;
    }
    events.push({ event: parsed.data, meta: { goldenAction, goldenUseful } });
  });

  if (issues.length > 0) fail(fixtureName, issues);
  return { contractVersion: CONTRACT_VERSION, fixtureClock, events };
}

/** 解析 projects.json 载荷：非空且 id 唯一。 */
export function parseProjectsPayload(payload: unknown): ProjectsFixture {
  const fixtureName = PROJECTS_FIXTURE;
  const issues: string[] = [];
  if (!requireRecordPayload(payload, fixtureName, issues)) fail(fixtureName, issues);
  const root = payload;
  requireContractVersion(root, issues);

  const rawProjects = root.projects;
  if (!Array.isArray(rawProjects) || rawProjects.length === 0) {
    issues.push('projects must be a non-empty array');
    fail(fixtureName, issues);
  }

  const projects: ProjectFixture[] = [];
  const seenIds = new Set<string>();
  rawProjects.forEach((rawProject, index) => {
    if (!isRecord(rawProject)) {
      issues.push(`projects[${index}] must be an object`);
      return;
    }
    if (!isNonEmptyString(rawProject.id)) {
      issues.push(`projects[${index}] id must be a non-empty string`);
      return;
    }
    const id = rawProject.id;
    const { name, description, visibility } = rawProject;
    if (!isNonEmptyString(name) || !isNonEmptyString(description) || !isNonEmptyString(visibility)) {
      issues.push(`projects[${index}] (id=${id}) name/description/visibility must be non-empty strings`);
      return;
    }
    if (seenIds.has(id)) {
      issues.push(`projects[${index}] (id=${id}) duplicates an earlier project id`);
      return;
    }
    seenIds.add(id);
    projects.push({ id, name, description, visibility });
  });

  if (issues.length > 0) fail(fixtureName, issues);
  return { contractVersion: CONTRACT_VERSION, projects };
}

/** 解析 adversarial.json 载荷：至少 MIN_ADVERSARIAL_CASES 条且 id 唯一。 */
export function parseAdversarialPayload(payload: unknown): AdversarialFixture {
  const fixtureName = ADVERSARIAL_FIXTURE;
  const issues: string[] = [];
  if (!requireRecordPayload(payload, fixtureName, issues)) fail(fixtureName, issues);
  const root = payload;
  requireContractVersion(root, issues);

  const rawCases = root.cases;
  if (!Array.isArray(rawCases)) {
    issues.push('cases must be an array');
    fail(fixtureName, issues);
  }
  if (rawCases.length < MIN_ADVERSARIAL_CASES) {
    issues.push(`cases must contain at least ${MIN_ADVERSARIAL_CASES} entries but got ${rawCases.length}`);
  }

  const cases: AdversarialCase[] = [];
  const seenIds = new Set<string>();
  rawCases.forEach((rawCase, index) => {
    if (!isRecord(rawCase)) {
      issues.push(`cases[${index}] must be an object`);
      return;
    }
    if (!isNonEmptyString(rawCase.id)) {
      issues.push(`cases[${index}] id must be a non-empty string`);
      return;
    }
    const id = rawCase.id;
    if (!isNonEmptyString(rawCase.kind)) {
      issues.push(`cases[${index}] (id=${id}) kind must be a non-empty string`);
      return;
    }
    if (!isNonEmptyString(rawCase.expected)) {
      issues.push(`cases[${index}] (id=${id}) expected must be a non-empty string`);
      return;
    }
    if (!('input' in rawCase)) {
      issues.push(`cases[${index}] (id=${id}) input is required`);
      return;
    }
    if (seenIds.has(id)) {
      issues.push(`cases[${index}] (id=${id}) duplicates an earlier case id`);
      return;
    }
    seenIds.add(id);
    cases.push({ id, kind: rawCase.kind, input: rawCase.input, expected: rawCase.expected });
  });

  if (issues.length > 0) fail(fixtureName, issues);
  return { contractVersion: CONTRACT_VERSION, cases };
}

/**
 * 解析 demo-walkthrough.json 载荷。
 * 若提供 knownEventIds，则每个 scenario 的 eventId 必须能在 events 中找到。
 */
export function parseDemoWalkthroughPayload(
  payload: unknown,
  knownEventIds?: ReadonlySet<string>,
): DemoWalkthroughFixture {
  const fixtureName = DEMO_WALKTHROUGH_FIXTURE;
  const issues: string[] = [];
  if (!requireRecordPayload(payload, fixtureName, issues)) fail(fixtureName, issues);
  const root = payload;
  requireContractVersion(root, issues);

  const rawScenarios = root.scenarios;
  if (!Array.isArray(rawScenarios) || rawScenarios.length === 0) {
    issues.push('scenarios must be a non-empty array');
    fail(fixtureName, issues);
  }

  const scenarios: DemoScenario[] = [];
  const seenIds = new Set<string>();
  rawScenarios.forEach((rawScenario, index) => {
    if (!isRecord(rawScenario)) {
      issues.push(`scenarios[${index}] must be an object`);
      return;
    }
    if (!isNonEmptyString(rawScenario.id)) {
      issues.push(`scenarios[${index}] id must be a non-empty string`);
      return;
    }
    const id = rawScenario.id;
    const { name, eventId, cardTitle, whyNow, expectedArtifact, verification } = rawScenario;
    if (
      !isNonEmptyString(name) ||
      !isNonEmptyString(eventId) ||
      !isNonEmptyString(cardTitle) ||
      !isNonEmptyString(whyNow) ||
      !isNonEmptyString(expectedArtifact) ||
      !isNonEmptyString(verification)
    ) {
      issues.push(
        `scenarios[${index}] (id=${id}) name/eventId/cardTitle/whyNow/expectedArtifact/verification must be non-empty strings`,
      );
      return;
    }
    const actionType = ActionTypeSchema.safeParse(rawScenario.actionType);
    if (!actionType.success) {
      issues.push(`scenarios[${index}] (id=${id}) actionType must be a valid ActionType`);
      return;
    }
    const risk = RiskSchema.safeParse(rawScenario.risk);
    if (!risk.success) {
      issues.push(`scenarios[${index}] (id=${id}) risk must be a valid Risk`);
      return;
    }
    if (seenIds.has(id)) {
      issues.push(`scenarios[${index}] (id=${id}) duplicates an earlier scenario id`);
      return;
    }
    if (knownEventIds && !knownEventIds.has(eventId)) {
      issues.push(`scenarios[${index}] (id=${id}) references unknown eventId=${eventId}`);
      return;
    }
    seenIds.add(id);
    scenarios.push({
      id,
      name,
      eventId,
      cardTitle,
      whyNow,
      actionType: actionType.data,
      expectedArtifact,
      verification,
      risk: risk.data,
    });
  });

  if (issues.length > 0) fail(fixtureName, issues);
  return { contractVersion: CONTRACT_VERSION, scenarios };
}

/** goldenUseful=true 的事件 id 集合（噪声与重复事件天然被排除）。 */
export function goldenUsefulEventIds(events: readonly LoadedFixtureEvent[]): Set<string> {
  return new Set(events.filter((fe) => fe.meta.goldenUseful).map((fe) => fe.event.id));
}

export function loadEventsFixture(rootDir: string): EventsFixture {
  return parseEventsPayload(readFixtureJson(rootDir, EVENTS_FIXTURE));
}

export function loadProjectsFixture(rootDir: string): ProjectsFixture {
  return parseProjectsPayload(readFixtureJson(rootDir, PROJECTS_FIXTURE));
}

export function loadAdversarialFixture(rootDir: string): AdversarialFixture {
  return parseAdversarialPayload(readFixtureJson(rootDir, ADVERSARIAL_FIXTURE));
}

export function loadDemoWalkthroughFixture(
  rootDir: string,
  knownEventIds?: ReadonlySet<string>,
): DemoWalkthroughFixture {
  return parseDemoWalkthroughPayload(
    readFixtureJson(rootDir, DEMO_WALKTHROUGH_FIXTURE),
    knownEventIds,
  );
}

/** 一次性加载四个 fixture 并完成 demo-walkthrough 与 events 的交叉校验。 */
export function loadFixtures(rootDir: string): Fixtures {
  const events = loadEventsFixture(rootDir);
  const knownEventIds = new Set(events.events.map((fe) => fe.event.id));
  return {
    events,
    projects: loadProjectsFixture(rootDir),
    adversarial: loadAdversarialFixture(rootDir),
    demoWalkthrough: loadDemoWalkthroughFixture(rootDir, knownEventIds),
  };
}

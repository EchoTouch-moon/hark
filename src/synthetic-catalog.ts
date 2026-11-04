import { z } from 'zod';

// Fixed fictional material only. IDs are catalog keys, never file paths.
// This module does not discover files, observe real projects, or grant access.
const ProjectId = z.enum(['project-a', 'project-b']);
type ProjectId = z.infer<typeof ProjectId>;
type ProjectKind = 'simulated_git_marker' | 'simulated_non_git';

export type SyntheticProject = {
  id: ProjectId;
  title: string;
  kind: ProjectKind;
  synthetic: true;
  source: { id: string; projectId: ProjectId; title: string; text: string; synthetic: true };
};

export type SyntheticCatalog = {
  synthetic: true;
  projects: Array<Pick<SyntheticProject, 'id' | 'title' | 'kind' | 'synthetic'>>;
  unassigned: Array<{ id: string; title: string; text: string; attribution: 'unknown'; synthetic: true }>;
};

const PROJECTS: Record<ProjectId, SyntheticProject> = {
  'project-a': {
    id: 'project-a', title: '星光书签', kind: 'simulated_git_marker', synthetic: true,
    source: {
      id: 'source-project-a-1', projectId: 'project-a', title: '虚构项目材料', synthetic: true,
      text: '# 星光书签\n\n目标：制作一个用于整理虚构阅读笔记的书签清单。\n成果：已写出本地清单的初步分类方案。\n待办：为清单补充按主题筛选的说明。',
    },
  },
  'project-b': {
    id: 'project-b', title: '雨滴记录', kind: 'simulated_non_git', synthetic: true,
    source: {
      id: 'source-project-b-1', projectId: 'project-b', title: '虚构项目材料', synthetic: true,
      text: '# 雨滴记录\n\n目标：整理一份虚构的每日天气观察记录。\n成果：已准备一页手写记录格式的示例。\n待办：决定如何在记录中标注日期和天气变化。',
    },
  },
};

/** A fresh snapshot; modifying it cannot alter future catalog reads. */
export function listSyntheticCatalog(): SyntheticCatalog {
  return {
    synthetic: true,
    projects: (['project-a', 'project-b'] as const).map(id => {
      const { title, kind } = PROJECTS[id];
      return { id, title, kind, synthetic: true };
    }),
    unassigned: [{
      id: 'unassigned-1', title: '未归属记录',
      text: '待办：整理尚未分类的一页草稿。该记录没有足够信息判断所属项目。',
      attribution: 'unknown', synthetic: true,
    }],
  };
}

/** Unknown IDs and paths are unavailable; no caller-provided path is opened. */
export function getSyntheticProject(input: unknown): SyntheticProject | null {
  const id = ProjectId.safeParse(input);
  if (!id.success) return null;
  const project = PROJECTS[id.data];
  return { ...project, source: { ...project.source } };
}

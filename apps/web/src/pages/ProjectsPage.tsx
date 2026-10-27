import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, PageHeader } from '../components';
import { fetchProjects, type ProjectSummary } from '../features/projects';
import './ProjectsPage.css';

/**
 * U03 Projects 列表（M1-T07）：
 * 两个合成项目的磁贴（名称/描述来自 GET /api/v1/projects），
 * 点击进入 /projects/:id。数据隔离由服务端保证。
 */
export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchProjects(controller.signal);
        if (!cancelled) {
          setProjects(list);
          setError(null);
        }
      } catch (cause) {
        if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        setError(cause instanceof Error ? cause.message : '加载项目列表失败');
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadKey]);

  const retry = useCallback(() => {
    setProjects(null);
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  const showLoading = projects === null && error === null;

  return (
    <section className="page">
      <PageHeader title="项目" subtitle="你授权给 Hearth 关注的项目，数据按项目严格隔离" />
      <div className="page-section" aria-busy={showLoading} aria-label="项目列表">
        {showLoading ? (
          <div className="project-grid" aria-hidden="true">
            <div className="skeleton skeleton-tile" />
            <div className="skeleton skeleton-tile" />
          </div>
        ) : error !== null ? (
          <ErrorState message={error} onRetry={retry} />
        ) : projects !== null && projects.length === 0 ? (
          <EmptyState
            title="还没有项目"
            hint="初始化演示数据后，会在这里看到 Project Atlas 与 Project Beacon 两个合成项目"
          />
        ) : (
          <ul className="project-grid">
            {projects?.map((project) => (
              <li key={project.id}>
                <Link
                  to={`/projects/${encodeURIComponent(project.id)}`}
                  className="project-tile card"
                >
                  <span className="project-tile-name">{project.name}</span>
                  <span className="project-tile-desc">{project.description}</span>
                  <span className="project-tile-more">查看项目详情 →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

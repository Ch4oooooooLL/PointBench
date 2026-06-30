import { api } from '../api/client';

type CacheScope = 'detail' | 'overview';

interface ProjectCacheVersion {
  project_db_id: number;
  scope: CacheScope;
  version: string;
}

interface VersionedCacheEntry<T> {
  schemaVersion: 1;
  version: string;
  savedAt: string;
  data: T;
}

interface LoadVersionedProjectPageOptions<T> {
  cacheKey: string;
  projectId: number | string;
  scope: CacheScope;
  loadFresh: () => Promise<T>;
}

interface VersionedPageResult<T> {
  data: T;
  cacheHit: boolean;
  version: string;
}

const CACHE_PREFIX = 'pointbench:page-cache:v1:';

function readCache<T>(key: string): VersionedCacheEntry<T> | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as VersionedCacheEntry<T>;
    if (
      typeof entry !== 'object' ||
      entry === null ||
      entry.schemaVersion !== 1 ||
      typeof entry.version !== 'string' ||
      !('data' in entry)
    ) {
      localStorage.removeItem(key);
      return null;
    }
    return entry;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function writeCache<T>(key: string, version: string, data: T): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 1,
        version,
        savedAt: new Date().toISOString(),
        data,
      } satisfies VersionedCacheEntry<T>),
    );
  } catch {
    // 浏览器存储可能被禁用或达到配额；此时页面仍使用本次服务端数据。
  }
}

export async function loadVersionedProjectPage<T>({
  cacheKey,
  projectId,
  scope,
  loadFresh,
}: LoadVersionedProjectPageOptions<T>): Promise<VersionedPageResult<T>> {
  const versionInfo = await api.get<ProjectCacheVersion>(`/api/projects/${projectId}/cache-version?scope=${scope}`);
  const storageKey = `${CACHE_PREFIX}${cacheKey}`;
  const cached = readCache<T>(storageKey);
  if (cached?.version === versionInfo.version) {
    return { data: cached.data, cacheHit: true, version: versionInfo.version };
  }

  const data = await loadFresh();
  writeCache(storageKey, versionInfo.version, data);
  return { data, cacheHit: false, version: versionInfo.version };
}

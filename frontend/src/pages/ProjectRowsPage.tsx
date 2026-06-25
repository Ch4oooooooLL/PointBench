import { ImageOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, mediaUrl } from '../api/client';
import { ProjectSelector } from '../components/ProjectSelector';
import { TrendChart } from '../components/TrendChart';
import { useAppContext } from '../context/AppContext';
import { Point, TrendItem } from '../types';
import { growthPercent, riskLabel, riskLevel, riskPercentText } from '../utils/risk';

interface PointRow {
  point: Point;
  trend: TrendItem[];
}

export function ProjectRowsPage() {
  const { selectedProject, selectedProjectId, riskSettings } = useAppContext();
  const [rows, setRows] = useState<PointRow[]>([]);
  const [active, setActive] = useState<PointRow | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!selectedProjectId) {
      setRows([]);
      return;
    }
    setRows([]);
    setError('');
    api.get<Point[]>(`/api/projects/${selectedProjectId}/points`)
      .then(async (points) => {
        const data = await Promise.all(
          points.map(async (point) => ({
            point,
            trend: await api.get<TrendItem[]>(`/api/points/${point.id}/trend`),
          })),
        );
        setRows(data);
      })
      .catch((err) => setError(err.message));
  }, [selectedProjectId]);

  const riskCounts = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const initial = firstStress(row.trend);
        const latest = latestStress(row.trend);
        const level = riskLevel(growthPercent(latest, initial), riskSettings);
        acc[level] += 1;
        return acc;
      },
      { normal: 0, warn: 0, danger: 0, critical: 0 },
    );
  }, [rows, riskSettings]);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>项目详情</h1>
          <p>每行一个点位，展示图片、名称、历次应力幅和按初始值增长百分比计算的风险标识。</p>
        </div>
        <ProjectSelector />
      </div>

      {!selectedProject && <div className="empty panel">暂无可用项目，请先导入项目 zip。</div>}
      {error && <div className="alert danger">{error}</div>}

      {selectedProject && (
        <>
          <div className="risk-summary">
            <span className="risk-badge normal">正常 {riskCounts.normal}</span>
            <span className="risk-badge warn">预警 {riskCounts.warn}</span>
            <span className="risk-badge danger">危险 {riskCounts.danger}</span>
            <span className="risk-badge critical">严重 {riskCounts.critical}</span>
          </div>
          <div className="point-row-list">
            {rows.map((row) => (
              <PointRiskRow key={row.point.id} row={row} onOpen={() => setActive(row)} />
            ))}
            {!rows.length && <div className="empty panel">当前项目暂无点位</div>}
          </div>
        </>
      )}

      {active && <PointRiskModal row={active} onClose={() => setActive(null)} />}
    </section>
  );
}

function PointRiskRow({ row, onOpen }: { row: PointRow; onOpen: () => void }) {
  const { riskSettings } = useAppContext();
  const initial = firstStress(row.trend);
  const latest = latestStress(row.trend);
  const percent = growthPercent(latest, initial);
  const level = riskLevel(percent, riskSettings);

  return (
    <button className={`point-risk-row ${level}`} onClick={onOpen}>
      <div className="row-thumb">
        {row.point.media_files[0] ? <img src={mediaUrl(row.point.media_files[0].id)} alt={row.point.point_name} /> : <ImageOff size={28} />}
      </div>
      <div className="row-main">
        <div className="point-row-title">
          <strong>{row.point.point_id} · {row.point.point_name}</strong>
          <span className={`risk-badge ${level}`}>{riskLabel(level)} {riskPercentText(percent)}</span>
        </div>
        <p>{row.point.component || '-'} · {row.point.direction || '-'} · {row.point.bridge_type || '-'}</p>
        <div className="stress-history">
          {row.trend.map((item) => {
            const itemPercent = growthPercent(item.stress_amplitude_mpa, initial);
            const itemLevel = riskLevel(itemPercent, riskSettings);
            return (
              <span className={`stress-chip ${itemLevel}`} key={item.run_id}>
                {item.cycle_count}: {item.stress_amplitude_mpa?.toFixed(1) ?? '-'} MPa
              </span>
            );
          })}
          {!row.trend.length && <span className="muted">暂无测试记录</span>}
        </div>
      </div>
    </button>
  );
}

function PointRiskModal({ row, onClose }: { row: PointRow; onClose: () => void }) {
  const { riskSettings } = useAppContext();
  const initial = firstStress(row.trend);
  const [previewUrl, setPreviewUrl] = useState('');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal point-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-head">
          <div>
            <h2>{row.point.point_id} · {row.point.point_name}</h2>
            <p>{row.point.component || '-'} · {row.point.position_description || '未填写位置描述'}</p>
          </div>
          <button className="button" onClick={onClose}>关闭</button>
        </div>
        <div className="detail-grid">
          <div className="photo-grid">
            {row.point.media_files.map((media) => (
              <button className="photo-button" onClick={() => setPreviewUrl(mediaUrl(media.id))} key={media.id}>
                <img src={mediaUrl(media.id)} alt={media.filename} />
                <span>{media.type} · {media.filename}</span>
              </button>
            ))}
          </div>
          <div>
            <TrendChart data={row.trend} metric="stress_amplitude_mpa" />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>轮次</th>
                <th>循环次数</th>
                <th>最大应变</th>
                <th>最小应变</th>
                <th>应变幅</th>
                <th>应力幅</th>
                <th>相对初始</th>
                <th>异常原因</th>
              </tr>
            </thead>
            <tbody>
              {row.trend.map((item) => {
                const percent = growthPercent(item.stress_amplitude_mpa, initial);
                const level = riskLevel(percent, riskSettings);
                return (
                  <tr key={item.run_id}>
                    <td>{item.run_name}</td>
                    <td>{item.cycle_count}</td>
                    <td>{item.max_strain_ue ?? '-'}</td>
                    <td>{item.min_strain_ue ?? '-'}</td>
                    <td>{item.amplitude_strain_ue?.toFixed(1) ?? '-'}</td>
                    <td>{item.stress_amplitude_mpa?.toFixed(2) ?? '-'}</td>
                    <td><span className={`risk-badge ${level}`}>{riskPercentText(percent)}</span></td>
                    <td>{item.abnormal_reason || '-'}</td>
                  </tr>
                );
              })}
              {!row.trend.length && <tr><td colSpan={8} className="empty">暂无测试记录</td></tr>}
            </tbody>
          </table>
        </div>
        {previewUrl && (
          <div className="modal-backdrop" onClick={() => setPreviewUrl('')}>
            <div className="modal image-preview-modal" onClick={(event) => event.stopPropagation()}>
              <div className="section-head">
                <h2>图片预览</h2>
                <button className="button" onClick={() => setPreviewUrl('')}>关闭</button>
              </div>
              <img src={previewUrl} alt="图片预览" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function firstStress(trend: TrendItem[]): number | null {
  return trend.find((item) => item.stress_amplitude_mpa != null)?.stress_amplitude_mpa ?? null;
}

function latestStress(trend: TrendItem[]): number | null {
  return [...trend].reverse().find((item) => item.stress_amplitude_mpa != null)?.stress_amplitude_mpa ?? null;
}

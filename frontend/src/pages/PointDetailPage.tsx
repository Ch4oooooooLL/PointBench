import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, mediaUrl } from '../api/client';
import { StatusPill } from '../components/StatusPill';
import { TrendChart } from '../components/TrendChart';
import { Measurement, Point, TrendItem } from '../types';

type Metric = 'max_strain_ue' | 'min_strain_ue' | 'amplitude_strain_ue' | 'stress_amplitude_mpa';

export function PointDetailPage() {
  const { pointId } = useParams();
  const [point, setPoint] = useState<Point | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [trend, setTrend] = useState<TrendItem[]>([]);
  const [metric, setMetric] = useState<Metric>('amplitude_strain_ue');
  const [remark, setRemark] = useState('');
  const [checkStatus, setCheckStatus] = useState('');

  const load = () => {
    api.get<Point>(`/api/points/${pointId}`).then((data) => {
      setPoint(data);
      setRemark(data.remark || '');
      setCheckStatus(data.check_status || '');
    });
    api.get<Measurement[]>(`/api/points/${pointId}/measurements`).then(setMeasurements);
    api.get<TrendItem[]>(`/api/points/${pointId}/trend`).then(setTrend);
  };

  useEffect(load, [pointId]);

  async function save() {
    await api.put(`/api/points/${pointId}`, { remark, check_status: checkStatus });
    load();
  }

  if (!point) return <div className="empty">加载中...</div>;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>{point.point_id} · {point.point_name}</h1>
          <p>{point.component || '-'} · {point.direction || '-'} · {point.bridge_type || '-'}</p>
        </div>
        <Link className="button" to={`/projects/${point.project_db_id}`}>返回项目</Link>
      </div>
      <div className="detail-grid">
        <div className="panel">
          <h2>点位信息</h2>
          <div className="kv-grid compact">
            <div><span>点位类型</span><strong>{point.point_type}</strong></div>
            <div><span>方位</span><strong>{point.side || '-'}</strong></div>
            <div><span>电阻</span><strong>{point.resistance_ohm ?? '-'}</strong></div>
            <div><span>安装状态</span><strong>{point.install_status}</strong></div>
          </div>
          <p>{point.position_description || '未填写位置描述'}</p>
          <label>检查状态<input value={checkStatus} onChange={(e) => setCheckStatus(e.target.value)} /></label>
          <label>备注<textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={4} /></label>
          <button className="button primary" onClick={save}><Save size={18} />保存</button>
        </div>
        <div className="panel">
          <h2>照片</h2>
          <div className="photo-grid">
            {point.media_files.map((media) => (
              <a key={media.id} href={mediaUrl(media.id)} target="_blank">
                <img src={mediaUrl(media.id)} alt={media.remark || media.filename} />
                <span>{media.type} · {media.filename}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="section-head">
          <h2>趋势图</h2>
          <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
            <option value="max_strain_ue">最大应变</option>
            <option value="min_strain_ue">最小应变</option>
            <option value="amplitude_strain_ue">应变幅</option>
            <option value="stress_amplitude_mpa">应力幅</option>
          </select>
        </div>
        <TrendChart data={trend} metric={metric} />
      </div>
      <div className="detail-grid">
        <div className="panel">
          <h2>通道信息</h2>
          {point.channels.map((channel) => (
            <div className="kv-grid compact" key={channel.id}>
              <div><span>设备</span><strong>{channel.device || '-'}</strong></div>
              <div><span>通道</span><strong>{channel.channel_name || '-'}</strong></div>
              <div><span>单位</span><strong>{channel.unit || '-'}</strong></div>
              <div><span>采样率</span><strong>{channel.sample_rate_hz ?? '-'}</strong></div>
            </div>
          ))}
        </div>
        <div className="panel">
          <h2>CAE 映射</h2>
          {point.cae_mappings?.map((item) => (
            <div className="kv-grid compact" key={item.id}>
              <div><span>CAE 点</span><strong>{item.cae_point_id || '-'}</strong></div>
              <div><span>部件</span><strong>{item.cae_component || '-'}</strong></div>
              <div><span>结果</span><strong>{item.cae_result_type || '-'}</strong></div>
              <div><span>危险等级</span><strong>{item.danger_level || '-'}</strong></div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h2>测试数据</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>轮次</th><th>最大应变</th><th>最小应变</th><th>应变幅</th><th>应力幅</th><th>异常</th><th>原因</th></tr></thead>
            <tbody>
              {measurements.map((item) => (
                <tr key={item.id}>
                  <td>{item.run_id}</td>
                  <td>{item.max_strain_ue ?? '-'}</td>
                  <td>{item.min_strain_ue ?? '-'}</td>
                  <td>{item.amplitude_strain_ue?.toFixed(2) ?? '-'}</td>
                  <td>{item.stress_amplitude_mpa?.toFixed(2) ?? '-'}</td>
                  <td><StatusPill value={item.is_abnormal} tone={item.is_abnormal ? 'danger' : 'ok'} /></td>
                  <td>{item.abnormal_reason || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

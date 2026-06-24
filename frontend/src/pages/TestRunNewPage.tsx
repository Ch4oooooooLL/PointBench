import { DatabaseZap, Download, FileSpreadsheet, Save, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ExcelJS from 'exceljs/dist/exceljs.min.js';
import { api } from '../api/client';
import { DewesoftImport, Point, TestRun } from '../types';

interface RowState {
  max_strain_ue: string;
  min_strain_ue: string;
  is_abnormal: boolean;
  remark: string;
}

type EntryMode = 'manual' | 'xlsx' | 'dewesoft';

const TEMPLATE_HEADERS = ['run_name', 'cycle_count', 'test_time', 'point_id', 'point_name', 'max_strain_ue', 'min_strain_ue', 'remark'];

export function TestRunNewPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<EntryMode>('manual');
  const [points, setPoints] = useState<Point[]>([]);
  const [runName, setRunName] = useState('');
  const [cycleCount, setCycleCount] = useState('');
  const [testTime, setTestTime] = useState('');
  const [remark, setRemark] = useState('');
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [importMessage, setImportMessage] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [templateRunCount, setTemplateRunCount] = useState('10');
  const [dewesoftCycleCount, setDewesoftCycleCount] = useState('');
  const [dewesoftRunName, setDewesoftRunName] = useState('');
  const [dewesoftMessage, setDewesoftMessage] = useState('');
  const [dewesoftBusy, setDewesoftBusy] = useState(false);
  const [lastDewesoftImport, setLastDewesoftImport] = useState<DewesoftImport | null>(null);

  useEffect(() => {
    api.get<Point[]>(`/api/projects/${projectId}/points`).then((data) => {
      setPoints(data);
      setRows(Object.fromEntries(data.map((point) => [point.id, { max_strain_ue: '', min_strain_ue: '', is_abnormal: false, remark: '' }])));
    });
  }, [projectId]);

  const pointMap = useMemo(() => new Map(points.map((point) => [point.point_id, point])), [points]);

  const filledRows = useMemo(
    () =>
      points
        .map((point) => ({ point, row: rows[point.id] }))
        .filter(({ row }) => row && (row.max_strain_ue !== '' || row.min_strain_ue !== '' || row.remark !== '' || row.is_abnormal)),
    [points, rows],
  );

  function calc(row: RowState) {
    const max = Number(row.max_strain_ue);
    const min = Number(row.min_strain_ue);
    if (Number.isNaN(max) || Number.isNaN(min) || row.max_strain_ue === '' || row.min_strain_ue === '') return null;
    const amplitude = (max - min) / 2;
    return { amplitude, stress: amplitude * 0.206 };
  }

  async function saveManual() {
    const run = await api.post<TestRun>(`/api/projects/${projectId}/test-runs`, {
      run_name: runName,
      cycle_count: Number(cycleCount),
      test_time: testTime || null,
      remark,
    });
    await api.post(`/api/test-runs/${run.id}/measurements`, {
      measurements: filledRows.map(({ point, row }) => ({
        point_db_id: point.id,
        max_strain_ue: row.max_strain_ue === '' ? null : Number(row.max_strain_ue),
        min_strain_ue: row.min_strain_ue === '' ? null : Number(row.min_strain_ue),
        is_abnormal: row.is_abnormal,
        remark: row.remark,
      })),
    });
    navigate(`/projects/${projectId}/analysis`);
  }

  async function downloadTemplate() {
    const runTotal = Math.max(1, Number(templateRunCount) || 1);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('measurements');
    sheet.columns = [
      { header: 'run_name', key: 'run_name', width: 14 },
      { header: 'cycle_count', key: 'cycle_count', width: 12 },
      { header: 'test_time', key: 'test_time', width: 26 },
      { header: 'point_id', key: 'point_id', width: 12 },
      { header: 'point_name', key: 'point_name', width: 24 },
      { header: 'max_strain_ue', key: 'max_strain_ue', width: 16 },
      { header: 'min_strain_ue', key: 'min_strain_ue', width: 16 },
      { header: 'remark', key: 'remark', width: 24 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (let runIndex = 1; runIndex <= runTotal; runIndex += 1) {
      for (const point of points) {
        sheet.addRow({
          run_name: `R${String(runIndex).padStart(2, '0')}`,
          cycle_count: '',
          test_time: '',
          point_id: point.point_id,
          point_name: point.point_name,
          max_strain_ue: '',
          min_strain_ue: '',
          remark: '',
        });
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `test_measurement_template_${projectId}_${runTotal}runs.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importXlsx(file?: File) {
    if (!file) return;
    setImportBusy(true);
    setImportMessage('');
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api.post<{ run_count: number; created_run_count: number; measurement_count: number }>(
        `/api/projects/${projectId}/measurements/import-xlsx`,
        form,
      );
      setImportMessage(`导入完成：${result.run_count} 个测试轮次，${result.measurement_count} 条测量记录。`);
    } catch (err) {
      setImportMessage(`导入失败：${(err as Error).message}`);
    } finally {
      setImportBusy(false);
    }
  }

  async function importDewesoft(file?: File) {
    if (!file) return;
    if (!dewesoftCycleCount || !Number.isFinite(Number(dewesoftCycleCount))) {
      setDewesoftMessage('请先填写本次导入对应的循环次数。');
      return;
    }
    setDewesoftBusy(true);
    setDewesoftMessage('');
    setLastDewesoftImport(null);
    try {
      const form = new FormData();
      form.append('cycle_count', dewesoftCycleCount);
      if (dewesoftRunName) form.append('run_name', dewesoftRunName);
      form.append('file', file);
      const result = await api.post<DewesoftImport>(`/api/dewesoft/projects/${projectId}/imports`, form);
      setLastDewesoftImport(result);
      if (result.status === 'imported') {
        setDewesoftMessage(`导入完成：匹配 ${result.matched_channel_count} 个点位通道，未匹配 ${result.unmatched_channel_count} 个通道。`);
      } else {
        setDewesoftMessage(`导入未完成：${result.message || '请查看导入记录'}`);
      }
    } catch (err) {
      setDewesoftMessage(`导入失败：${(err as Error).message}`);
    } finally {
      setDewesoftBusy(false);
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>录入测试数据</h1>
          <p>支持手动录入、XLSX 模板批量导入；Dewesoft 数据导入入口已预留。</p>
        </div>
      </div>

      <div className="mode-tabs">
        <button className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>手动录入</button>
        <button className={mode === 'xlsx' ? 'active' : ''} onClick={() => setMode('xlsx')}>XLSX 模板导入</button>
        <button className={mode === 'dewesoft' ? 'active' : ''} onClick={() => setMode('dewesoft')}>Dewesoft 数据</button>
      </div>

      {mode === 'manual' && (
        <>
          <div className="section-head">
            <div>
              <h2>手动录入单次测试轮次</h2>
              <p>录入最大应变和最小应变后自动计算应变幅、应力幅。</p>
            </div>
            <button className="button primary" disabled={!runName || !cycleCount} onClick={saveManual}><Save size={18} />保存</button>
          </div>
          <div className="form-row">
            <label>轮次名称<input value={runName} onChange={(e) => setRunName(e.target.value)} /></label>
            <label>循环次数<input type="number" value={cycleCount} onChange={(e) => setCycleCount(e.target.value)} /></label>
            <label>测试时间<input value={testTime} onChange={(e) => setTestTime(e.target.value)} placeholder="2026-06-24T14:30:00+08:00" /></label>
            <label>备注<input value={remark} onChange={(e) => setRemark(e.target.value)} /></label>
          </div>
          <ManualEntryTable points={points} rows={rows} setRows={setRows} calc={calc} />
        </>
      )}

      {mode === 'xlsx' && (
        <div className="panel import-mode-panel">
          <div className="section-head">
            <div>
              <h2>XLSX 模板批量导入</h2>
              <p>先输入已测试记录次数并下载模板，再填写每个点位在各循环次数下的最大/最小应变。</p>
            </div>
          </div>
          <div className="template-controls">
            <label>
              已测试记录次数
              <input type="number" min="1" value={templateRunCount} onChange={(event) => setTemplateRunCount(event.target.value)} />
            </label>
          </div>
          <div className="import-actions">
            <button className="button" onClick={downloadTemplate} disabled={!points.length}>
              <Download size={18} />
              下载 XLSX 模板
            </button>
            <label className="button primary file-button">
              <Upload size={18} />
              {importBusy ? '导入中...' : '导入 XLSX 文件'}
              <input type="file" accept=".xlsx,.xlsm" disabled={importBusy} onChange={(event) => importXlsx(event.target.files?.[0])} />
            </label>
          </div>
          <div className="template-note">
            <FileSpreadsheet size={18} />
            模板工作表名为 measurements；cycle_count 会留空，请按实际循环次数填写后再导入。
          </div>
          {importMessage && <div className={importMessage.startsWith('导入失败') ? 'alert danger' : 'alert ok'}>{importMessage}</div>}
        </div>
      )}

      {mode === 'dewesoft' && (
        <div className="panel import-mode-panel">
          <div className="section-head">
            <div>
              <h2>Dewesoft 数据导入</h2>
              <p>上传 .dxd/.dxz 原始记录文件，或 Dewesoft 导出的 .csv/.txt，系统读取总时长中间 1/10 稳定段，按通道名匹配点位编号并计算最大/最小应变。</p>
            </div>
          </div>
          <div className="form-row dewesoft-form">
            <label>本次循环次数<input type="number" value={dewesoftCycleCount} onChange={(e) => setDewesoftCycleCount(e.target.value)} /></label>
            <label>轮次名称<input value={dewesoftRunName} onChange={(e) => setDewesoftRunName(e.target.value)} placeholder="留空则自动生成" /></label>
          </div>
          <div className="import-actions">
            <label className="button primary file-button">
              <DatabaseZap size={18} />
              {dewesoftBusy ? '解析中...' : '选择 Dewesoft 数据文件'}
              <input type="file" accept=".dxd,.dxz,.d7d,.d7z,.csv,.txt" disabled={dewesoftBusy} onChange={(event) => importDewesoft(event.target.files?.[0])} />
            </label>
            <Link className="button" to={`/projects/${projectId}/dewesoft-imports`}>查看 Dewesoft 导入记录</Link>
          </div>
          <div className="template-note">
            <DatabaseZap size={18} />
            CSV/TXT 导出文件可直接解析；原始 .dxd/.dxz 文件需要本机后端环境可加载 Dewesoft 官方 DWDataReaderLib。
          </div>
          {dewesoftMessage && <div className={dewesoftMessage.includes('完成') ? 'alert ok' : 'alert danger'}>{dewesoftMessage}</div>}
          {lastDewesoftImport && <Link className="button" to={`/projects/${projectId}/dewesoft-imports`}>打开本次导入详情</Link>}
        </div>
      )}
    </section>
  );
}

function ManualEntryTable({
  points,
  rows,
  setRows,
  calc,
}: {
  points: Point[];
  rows: Record<number, RowState>;
  setRows: (rows: Record<number, RowState>) => void;
  calc: (row: RowState) => { amplitude: number; stress: number } | null;
}) {
  return (
    <div className="table-wrap">
      <table className="entry-table">
        <thead>
          <tr>
            <th>点位编号</th>
            <th>点位名称</th>
            <th>最大应变 ue</th>
            <th>最小应变 ue</th>
            <th>应变幅 ue</th>
            <th>应力幅 MPa</th>
            <th>异常</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => {
            const row = rows[point.id];
            const value = row ? calc(row) : null;
            return (
              <tr key={point.id}>
                <td>{point.point_id}</td>
                <td>{point.point_name}</td>
                <td><input type="number" value={row?.max_strain_ue || ''} onChange={(e) => setRows({ ...rows, [point.id]: { ...row, max_strain_ue: e.target.value } })} /></td>
                <td><input type="number" value={row?.min_strain_ue || ''} onChange={(e) => setRows({ ...rows, [point.id]: { ...row, min_strain_ue: e.target.value } })} /></td>
                <td>{value?.amplitude.toFixed(2) || '-'}</td>
                <td>{value?.stress.toFixed(2) || '-'}</td>
                <td><input type="checkbox" checked={row?.is_abnormal || false} onChange={(e) => setRows({ ...rows, [point.id]: { ...row, is_abnormal: e.target.checked } })} /></td>
                <td><input value={row?.remark || ''} onChange={(e) => setRows({ ...rows, [point.id]: { ...row, remark: e.target.value } })} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

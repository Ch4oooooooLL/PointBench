import { DatabaseZap, Download, FileSpreadsheet, Save, Upload, AlertTriangle, CheckCircle, XCircle, ChevronDown, ChevronRight, Search, Layers, ShieldAlert, CheckCircle2, Zap, FileText, Check } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ExcelJS from 'exceljs/dist/exceljs.min.js';
import { api } from '../api/client';
import { DewesoftImport, Point, TestRun, XlsxImportPreview, XlsxImportResult, XlsxImportStrategy, XlsxPreviewItem, XlsxRowStatus } from '../types';
import { calculateStressPreview, DEFAULT_STRESS_FORMULA } from '../utils/stressFormula';

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
  const [stressFormula, setStressFormula] = useState(DEFAULT_STRESS_FORMULA);
  const [importMessage, setImportMessage] = useState('');
  const [importMessageError, setImportMessageError] = useState(false);
  const [manualMessage, setManualMessage] = useState('');
  const [manualMessageError, setManualMessageError] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [templateRunCount, setTemplateRunCount] = useState('10');
  const loadPointsRequestRef = useRef(0);

  function showImportMessage(message: string, isError = false) {
    setImportMessage(message);
    setImportMessageError(isError);
  }

  // ── XLSX 多步导入流程状态 ──
  type XlsxStep = 'upload' | 'preview' | 'confirming' | 'result';
  const [xlsxStep, setXlsxStep] = useState<XlsxStep>('upload');
  const [xlsxPreview, setXlsxPreview] = useState<XlsxImportPreview | null>(null);
  const [xlsxResult, setXlsxResult] = useState<XlsxImportResult | null>(null);
  const [xlsxStrategy, setXlsxStrategy] = useState<XlsxImportStrategy>('append_only');
  const [xlsxUpdateRunMeta, setXlsxUpdateRunMeta] = useState(false);
  const [xlsxSkipUnknownPoints, setXlsxSkipUnknownPoints] = useState(false);
  const [xlsxSkipFileDuplicates, setXlsxSkipFileDuplicates] = useState(false);
  const [xlsxShowOverwriteConfirm, setXlsxShowOverwriteConfirm] = useState(false);
  const [xlsxShowAdvanced, setXlsxShowAdvanced] = useState(false);

  // ── 模板生成模式 ──
  type TemplateMode = 'new_cycles' | 'fill_missing';
  const [templateMode, setTemplateMode] = useState<TemplateMode>('new_cycles');
  const [templateCycleList, setTemplateCycleList] = useState<number[]>([]);
  const [templateCycleInput, setTemplateCycleInput] = useState('');
  const [templateCycleUnit, setTemplateCycleUnit] = useState('raw');
  const [templateSelectedRunId, setTemplateSelectedRunId] = useState('');
  const [existingRuns, setExistingRuns] = useState<TestRun[]>([]);
  const [dewesoftCycleCount, setDewesoftCycleCount] = useState('');
  const [dewesoftRunName, setDewesoftRunName] = useState('');
  const [dewesoftMessage, setDewesoftMessage] = useState('');
  const [dewesoftAlertTone, setDewesoftAlertTone] = useState<'ok' | 'danger'>('danger');
  const [dewesoftBusy, setDewesoftBusy] = useState(false);
  const [lastDewesoftImport, setLastDewesoftImport] = useState<DewesoftImport | null>(null);

  async function loadPoints() {
    if (!projectId) return;
    const requestId = ++loadPointsRequestRef.current;
    try {
      const data = await api.get<Point[]>(`/api/projects/${projectId}/points`);
      if (requestId !== loadPointsRequestRef.current) return;
      setPoints(data);
      setRows(Object.fromEntries(data.map((point) => [point.id, { max_strain_ue: '', min_strain_ue: '', is_abnormal: false, remark: '' }])));
    } catch (err) {
      if (requestId !== loadPointsRequestRef.current) return;
      setManualMessage(`点位列表加载失败：${(err as Error).message}`);
      setManualMessageError(true);
    }
  }

  useEffect(() => {
    loadPoints();
    loadExistingRuns();
    return () => {
      loadPointsRequestRef.current += 1;
    };
  }, [projectId]);

  useEffect(() => {
    api.get<{ stress_formula: string }>('/api/settings')
      .then((data) => setStressFormula(data.stress_formula || DEFAULT_STRESS_FORMULA))
      .catch(() => setStressFormula(DEFAULT_STRESS_FORMULA));
  }, []);

  async function loadExistingRuns() {
    if (!projectId) return;
    try {
      const runs = await api.get<TestRun[]>(`/api/projects/${projectId}/test-runs`);
      setExistingRuns(runs);
    } catch {
      // 静默失败
    }
  }

  async function refreshPointsAfterDewesoftImport() {
    await loadPoints();
  }

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
    return calculateStressPreview(max, min, stressFormula);
  }

  async function saveManual() {
    if (!projectId) return;
    const cycleCountValue = Number(cycleCount);
    if (!cycleCount.trim() || Number.isNaN(cycleCountValue)) {
      setManualMessage('保存失败：循环次数必须填写为数字。');
      setManualMessageError(true);
      return;
    }
    setManualBusy(true);
    setManualMessage('');
    try {
      const run = await api.post<TestRun>(`/api/projects/${projectId}/test-runs`, {
        run_name: runName,
        cycle_count: cycleCountValue,
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
    } catch (err) {
      setManualMessage(`保存失败：${(err as Error).message}`);
      setManualMessageError(true);
    } finally {
      setManualBusy(false);
    }
  }

  // ── 模板生成 ──
  async function downloadTemplate() {
    if (templateMode === 'new_cycles') {
      await downloadNewCyclesTemplate();
    } else {
      await downloadFillMissingTemplate();
    }
  }

  const CYCLE_UNITS: { value: string; label: string; multiplier: number }[] = [
    { value: 'raw', label: '次', multiplier: 1 },
    { value: 'k', label: 'k (千次)', multiplier: 1_000 },
    { value: 'w', label: 'w (万次)', multiplier: 10_000 },
    { value: 'kw', label: 'kw (千万次)', multiplier: 10_000_000 },
  ];

  function addCycleCount() {
    const raw = templateCycleInput.trim();
    if (!raw) return;
    const num = Number(raw);
    if (!Number.isInteger(num) || num < 0) {
      showImportMessage('请输入有效的非负整数', true);
      return;
    }
    const unit = CYCLE_UNITS.find(u => u.value === templateCycleUnit);
    const multiplier = unit?.multiplier ?? 1;
    const realValue = num * multiplier;
    if (realValue > 10_000_000_000) {
      showImportMessage('循环次数不能超过 100 亿', true);
      return;
    }
    if (templateCycleList.includes(realValue)) {
      showImportMessage(`循环次数 ${realValue.toLocaleString()} 已存在`, true);
      return;
    }
    setTemplateCycleList([...templateCycleList, realValue].sort((a, b) => a - b));
    setTemplateCycleInput('');
    showImportMessage('');
  }

  function removeCycleCount(val: number) {
    setTemplateCycleList(templateCycleList.filter(v => v !== val));
  }

  async function downloadNewCyclesTemplate() {
    const cycles = templateCycleList;
    if (cycles.length === 0) {
      showImportMessage('请至少添加一个循环次数', true);
      return;
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('measurements');
    sheet.columns = [
      { header: 'cycle_count', key: 'cycle_count', width: 12 },
      { header: 'run_name', key: 'run_name', width: 14 },
      { header: 'test_time', key: 'test_time', width: 26 },
      { header: 'point_id', key: 'point_id', width: 12 },
      { header: 'point_name', key: 'point_name', width: 24 },
      { header: 'max_strain_ue', key: 'max_strain_ue', width: 16 },
      { header: 'min_strain_ue', key: 'min_strain_ue', width: 16 },
      { header: 'remark', key: 'remark', width: 24 },
      { header: 'data_source', key: 'data_source', width: 16 },
      { header: 'operator', key: 'operator', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const cycle of cycles) {
      for (const point of points) {
        sheet.addRow({
          cycle_count: cycle,
          run_name: '',
          test_time: '',
          point_id: point.point_id,
          point_name: point.point_name,
          max_strain_ue: '',
          min_strain_ue: '',
          remark: '',
          data_source: '',
          operator: '',
        });
      }
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `measurement_template_${projectId}_${cycles.join('_')}cycles.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function downloadFillMissingTemplate() {
    const runId = Number(templateSelectedRunId);
    if (!runId) {
      showImportMessage('请先选择一个已有测试轮次', true);
      return;
    }
    const run = existingRuns.find(r => r.id === runId);
    if (!run) {
      showImportMessage('未找到所选轮次', true);
      return;
    }
    // 获取该轮次已有的测量记录
    let existingMeasurements: { point_db_id: number }[];
    try {
      existingMeasurements = await api.get<{ point_db_id: number }[]>(`/api/test-runs/${runId}/measurements`);
    } catch {
      showImportMessage('获取已有测量记录失败', true);
      return;
    }
    const existingPointIds = new Set(existingMeasurements.map(m => m.point_db_id));
    const missingPoints = points.filter(p => !existingPointIds.has(p.id));

    if (missingPoints.length === 0) {
      showImportMessage('当前轮次所有点位均已有测量记录。如需修改，请使用更新/覆盖导入策略。');
      return;
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('measurements');
    sheet.columns = [
      { header: 'cycle_count', key: 'cycle_count', width: 12 },
      { header: 'run_name', key: 'run_name', width: 14 },
      { header: 'test_time', key: 'test_time', width: 26 },
      { header: 'point_id', key: 'point_id', width: 12 },
      { header: 'point_name', key: 'point_name', width: 24 },
      { header: 'max_strain_ue', key: 'max_strain_ue', width: 16 },
      { header: 'min_strain_ue', key: 'min_strain_ue', width: 16 },
      { header: 'remark', key: 'remark', width: 24 },
      { header: 'data_source', key: 'data_source', width: 16 },
      { header: 'operator', key: 'operator', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const point of missingPoints) {
      sheet.addRow({
        cycle_count: run.cycle_count,
        run_name: run.run_name,
        test_time: run.test_time || '',
        point_id: point.point_id,
        point_name: point.point_name,
        max_strain_ue: '',
        min_strain_ue: '',
        remark: '',
        data_source: '',
        operator: '',
      });
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fill_missing_template_${projectId}_run${runId}_cycle${run.cycle_count}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ── XLSX 预览：上传文件并获取预览报告 ──
  async function previewXlsxImport(file?: File) {
    if (!file) return;
    setImportBusy(true);
    setImportMessage('');
    setImportMessageError(false);
    setXlsxPreview(null);
    setXlsxResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const preview = await api.post<XlsxImportPreview>(
        `/api/projects/${projectId}/measurements/import-xlsx/preview`,
        form,
      );
      setXlsxPreview(preview);
      setXlsxStep('preview');
      // 根据预览结果预调策略
      if (preview.existing_measurement_count > 0) {
        setXlsxStrategy('append_only');
      }
    } catch (err) {
      showImportMessage(`预览失败：${(err as Error).message}`, true);
    } finally {
      setImportBusy(false);
    }
  }

  // ── XLSX 确认导入 ──
  async function confirmXlsxImport() {
    if (!xlsxPreview) return;
    // overwrite 策略二次确认
    if (xlsxStrategy === 'overwrite' && !xlsxShowOverwriteConfirm) {
      setXlsxShowOverwriteConfirm(true);
      return;
    }
    setXlsxShowOverwriteConfirm(false);
    setXlsxStep('confirming');
    try {
      const result = await api.post<XlsxImportResult>(
        `/api/projects/${projectId}/measurements/import-xlsx/confirm`,
        {
          preview_id: xlsxPreview.preview_id,
          strategy: xlsxStrategy,
          update_run_meta: xlsxUpdateRunMeta,
          skip_unknown_points: xlsxSkipUnknownPoints,
          skip_file_duplicates: xlsxSkipFileDuplicates,
        },
      );
      setXlsxResult(result);
      setXlsxStep('result');
      // 刷新数据
      await loadExistingRuns();
    } catch (err) {
      showImportMessage(`导入失败：${(err as Error).message}`, true);
      setXlsxStep('preview');
    }
  }

  // ── 重置 XLSX 流程 ──
  function resetXlsxFlow() {
    setXlsxStep('upload');
    setXlsxPreview(null);
    setXlsxResult(null);
    setXlsxShowOverwriteConfirm(false);
    setImportMessage('');
  }

  async function importDewesoft(file?: File) {
    if (!file) return;
    const cycleCountText = dewesoftCycleCount.trim();
    const cycleCountValue = Number(cycleCountText);
    if (!cycleCountText || !Number.isFinite(cycleCountValue) || !Number.isInteger(cycleCountValue)) {
      setDewesoftAlertTone('danger');
      setDewesoftMessage('请先填写本次导入对应的整数循环次数。');
      return;
    }
    setDewesoftBusy(true);
    setDewesoftMessage('');
    setLastDewesoftImport(null);
    try {
      const form = new FormData();
      form.append('cycle_count', String(cycleCountValue));
      if (dewesoftRunName.trim()) form.append('run_name', dewesoftRunName.trim());
      form.append('file', file);
      const result = await api.post<DewesoftImport>(`/api/dewesoft/projects/${projectId}/imports`, form);
      setLastDewesoftImport(result);
      if (result.status === 'imported') {
        const message = result.message || `导入完成：匹配 ${result.matched_channel_count} 个点位通道，未匹配 ${result.unmatched_channel_count} 个通道。`;
        setDewesoftAlertTone('ok');
        setDewesoftMessage(message);
        if (message.includes('已自动新增')) {
          await refreshPointsAfterDewesoftImport();
          window.alert(`${message}。请到点位详情中补充对应信息。`);
        }
      } else {
        setDewesoftAlertTone('danger');
        setDewesoftMessage(`导入未完成：${result.message || '请查看导入记录'}`);
      }
    } catch (err) {
      setDewesoftAlertTone('danger');
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
          <p>支持手动录入；XLSX 批量追加/更新测量数据；Dewesoft 数据导入入口已预留。</p>
        </div>
      </div>

      <div className="mode-tabs">
        <button className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>手动录入</button>
        <button className={mode === 'xlsx' ? 'active' : ''} onClick={() => setMode('xlsx')}>XLSX 批量追加/更新</button>
        <button className={mode === 'dewesoft' ? 'active' : ''} onClick={() => setMode('dewesoft')}>Dewesoft 数据</button>
      </div>

      {mode === 'manual' && (
        <>
          <div className="section-head">
            <div>
              <h2>手动录入单次测试轮次</h2>
              <p>录入最大应变和最小应变后自动计算应变幅、应力幅。</p>
            </div>
            <button className="button primary" disabled={!runName || !cycleCount || manualBusy} onClick={saveManual}><Save size={18} />保存</button>
          </div>
          {manualMessage && <div className={manualMessageError ? 'alert danger' : 'alert ok'}>{manualMessage}</div>}
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
          {xlsxStep === 'upload' && (
            <>
              <div className="section-head">
                <div>
                  <h2>XLSX 批量追加/更新测量数据</h2>
                  <p>本功能只会向当前项目追加或更新测试轮次和测量记录，不会创建点位，也不会删除任何已有数据。</p>
                </div>
              </div>

              {/* ── 模板下载 ── */}
              <div className="template-section">
                <div className="mode-tabs" style={{ marginBottom: 14 }}>
                  <button className={templateMode === 'new_cycles' ? 'active' : ''} onClick={() => setTemplateMode('new_cycles')}>
                    新增循环次数模板
                  </button>
                  <button className={templateMode === 'fill_missing' ? 'active' : ''} onClick={() => setTemplateMode('fill_missing')}>
                    补录已有轮次模板
                  </button>
                </div>

                {templateMode === 'new_cycles' ? (
                  <div className="template-controls">
                    <label>循环次数</label>
                    <div className="cycle-input-row">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={templateCycleInput}
                        onChange={(e) => setTemplateCycleInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCycleCount(); } }}
                        placeholder="如 500"
                      />
                      <select
                        className="cycle-unit-select"
                        value={templateCycleUnit}
                        onChange={(e) => setTemplateCycleUnit(e.target.value)}
                      >
                        {CYCLE_UNITS.map((u) => (
                          <option key={u.value} value={u.value}>{u.label}</option>
                        ))}
                      </select>
                      <button className="button icon-button" onClick={addCycleCount} title="添加循环次数" style={{ width: 38, minHeight: 38 }}>
                        +
                      </button>
                    </div>
                    {templateCycleList.length > 0 && (
                      <div className="cycle-tag-list">
                        {templateCycleList.map((cc) => (
                          <span key={cc} className="cycle-tag">
                            {cc.toLocaleString()} 次
                            <button className="cycle-tag-remove" onClick={() => removeCycleCount(cc)} title="移除">&times;</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="hint">每个循环次数将生成当前项目所有点位的空测量行。按 Enter 或点击 + 添加，单位选择后自动换算为真实值。</p>
                  </div>
                ) : (
                  <div className="template-controls">
                    <label>
                      选择已有测试轮次
                      <select value={templateSelectedRunId} onChange={(e) => setTemplateSelectedRunId(e.target.value)}>
                        <option value="">-- 请选择 --</option>
                        {existingRuns.map((run) => (
                          <option key={run.id} value={run.id}>
                            {run.run_name} (cycle_count={run.cycle_count})
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="hint">系统将检查该轮次下缺失的点位，仅为缺失点位生成模板行。</p>
                  </div>
                )}
                <div className="import-actions">
                  <button className="button" onClick={downloadTemplate} disabled={!points.length}>
                    <Download size={18} />
                    下载 XLSX 模板
                  </button>
                </div>
              </div>

              {/* ── 文件上传 ── */}
              <hr />
              <div className="section-head">
                <div>
                  <h3>上传填写完成的 XLSX 文件</h3>
                  <p>支持 .xlsx / .xlsm 格式。模板工作表名为 measurements。</p>
                </div>
              </div>
              <div className="import-actions">
                <label className="button primary file-button">
                  <Upload size={18} />
                  {importBusy ? '解析中...' : '选择 XLSX 文件并预览'}
                  <input
                    type="file"
                    accept=".xlsx,.xlsm"
                    disabled={importBusy}
                    onChange={(event) => previewXlsxImport(event.target.files?.[0])}
                  />
                </label>
              </div>
              <div className="template-note">
                <FileSpreadsheet size={18} />
                上传后将显示详细预览报告，您可以选择导入策略，确认后才会写入数据库。
              </div>
            </>
          )}

          {xlsxStep === 'preview' && xlsxPreview && (
            <XlsxPreviewPanel
              preview={xlsxPreview}
              strategy={xlsxStrategy}
              onStrategyChange={setXlsxStrategy}
              updateRunMeta={xlsxUpdateRunMeta}
              onUpdateRunMetaChange={setXlsxUpdateRunMeta}
              skipUnknownPoints={xlsxSkipUnknownPoints}
              onSkipUnknownPointsChange={setXlsxSkipUnknownPoints}
              skipFileDuplicates={xlsxSkipFileDuplicates}
              onSkipFileDuplicatesChange={setXlsxSkipFileDuplicates}
              showAdvanced={xlsxShowAdvanced}
              onToggleAdvanced={() => setXlsxShowAdvanced(!xlsxShowAdvanced)}
              onConfirm={confirmXlsxImport}
              onCancel={resetXlsxFlow}
            />
          )}

          {xlsxStep === 'confirming' && (
            <div className="import-progress">
              <div className="spinner" />
              <p>正在导入数据，请稍候...</p>
            </div>
          )}

          {xlsxStep === 'result' && xlsxResult && (
            <XlsxResultPanel result={xlsxResult} onDone={() => navigate(`/projects/${projectId}/analysis`)} onRetry={resetXlsxFlow} />
          )}

          {importMessage && (
            <div className={importMessageError ? 'alert danger' : 'alert ok'}>{importMessage}</div>
          )}
        </div>
      )}

      {/* ── Overwrite 二次确认弹窗 ── */}
      {xlsxShowOverwriteConfirm && xlsxPreview && (
        <div className="modal-overlay" onClick={() => setXlsxShowOverwriteConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2><AlertTriangle size={24} /> 覆盖确认</h2>
            <p>该操作将<strong>覆盖已有测量记录</strong>。被覆盖的数据可能影响趋势分析和历史报告。是否继续？</p>
            <div className="overwrite-summary">
              <div>将覆盖记录数：<strong>{xlsxPreview.will_update_count}</strong></div>
              <div>涉及循环次数：<strong>{xlsxPreview.cycle_counts.join(', ')}</strong></div>
              <div>
                涉及点位数量：
                <strong>
                  {new Set(xlsxPreview.items.filter(i => i.status === 'existing_measurement').map(i => i.point_id)).size}
                </strong>
              </div>
            </div>
            <div className="modal-actions">
              <button className="button" onClick={() => setXlsxShowOverwriteConfirm(false)}>取消</button>
              <button className="button danger" onClick={confirmXlsxImport}>确认覆盖</button>
            </div>
          </div>
        </div>
      )}

      {mode === 'dewesoft' && (
        <div className="panel import-mode-panel">
          <div className="section-head">
            <div>
              <h2>Dewesoft 数据导入</h2>
              <p>上传 .dxd/.dxz 原始记录文件，或 Dewesoft 导出的 .csv/.txt，系统读取总时长中间 1/10 稳定段，按 01-点位名称 通道名匹配点位编号并计算最大/最小应变。</p>
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
          {dewesoftMessage && <div className={`alert ${dewesoftAlertTone}`}>{dewesoftMessage}</div>}
          {lastDewesoftImport && <Link className="button" to={`/projects/${projectId}/dewesoft-imports`}>打开本次导入详情</Link>}
        </div>
      )}
    </section>
  );
}

// ── XLSX 状态标签 ──
const STATUS_LABELS: Record<XlsxRowStatus, string> = {
  new_measurement: '新记录',
  existing_measurement: '已有记录',
  unknown_point: '未知点位',
  file_duplicate: '文件内重复',
  invalid: '无效行',
};

const STATUS_COLORS: Record<XlsxRowStatus, string> = {
  new_measurement: '#22c55e',
  existing_measurement: '#f59e0b',
  unknown_point: '#ef4444',
  file_duplicate: '#f97316',
  invalid: '#dc2626',
};

function StatusBadge({ status }: { status: XlsxRowStatus }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
        color: '#fff',
        backgroundColor: STATUS_COLORS[status],
        boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', opacity: 0.8 }} />
      {STATUS_LABELS[status]}
    </span>
  );
}

// ── 策略选项配置 ──
const STRATEGY_OPTIONS: { value: XlsxImportStrategy; label: string; desc: string }[] = [
  { value: 'append_only', label: '仅新增，不覆盖已有记录', desc: '只添加数据库中不存在的测量记录，已有记录保持不变。' },
  { value: 'fill_missing', label: '只填补空缺字段', desc: '已有记录中为空的字段用 XLSX 数据填充，非空字段不覆盖。' },
  { value: 'overwrite', label: '覆盖已有记录', desc: 'XLSX 中非空字段覆盖数据库中已有记录，需要二次确认。' },
  { value: 'strict', label: '严格模式：存在冲突则不导入', desc: '要求全部为新增有效数据，有任何已有记录、未知点位、重复或无效行则拒绝导入。' },
];

// ── XLSX 预览面板 ──
function XlsxPreviewPanel({
  preview,
  strategy,
  onStrategyChange,
  updateRunMeta,
  onUpdateRunMetaChange,
  skipUnknownPoints,
  onSkipUnknownPointsChange,
  skipFileDuplicates,
  onSkipFileDuplicatesChange,
  showAdvanced,
  onToggleAdvanced,
  onConfirm,
  onCancel,
}: {
  preview: XlsxImportPreview;
  strategy: XlsxImportStrategy;
  onStrategyChange: (s: XlsxImportStrategy) => void;
  updateRunMeta: boolean;
  onUpdateRunMetaChange: (v: boolean) => void;
  skipUnknownPoints: boolean;
  onSkipUnknownPointsChange: (v: boolean) => void;
  skipFileDuplicates: boolean;
  onSkipFileDuplicatesChange: (v: boolean) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const hasExisting = preview.existing_measurement_count > 0;
  const hasIssues = preview.invalid_rows > 0 || preview.unknown_point_count > 0 || preview.file_duplicate_count > 0;

  // 筛选与搜索状态
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyRisks, setOnlyRisks] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);

  // 计算各状态的数量与占比
  const counts = useMemo(() => {
    const map: Record<string, number> = {
      all: preview.items.length,
      new_measurement: 0,
      existing_measurement: 0,
      unknown_point: 0,
      file_duplicate: 0,
      invalid: 0,
    };
    preview.items.forEach((item) => {
      if (map[item.status] !== undefined) {
        map[item.status]++;
      }
    });
    return map;
  }, [preview.items]);

  // 计算各片段百分比
  const distributionPercentages = useMemo(() => {
    const total = preview.items.length || 1;
    return {
      new_pct: (counts.new_measurement / total) * 100,
      exist_pct: (counts.existing_measurement / total) * 100,
      unknown_pct: (counts.unknown_point / total) * 100,
      dup_pct: (counts.file_duplicate / total) * 100,
      invalid_pct: (counts.invalid / total) * 100,
    };
  }, [counts, preview.items.length]);

  // 过滤后的数据项
  const filteredItems = useMemo(() => {
    return preview.items.filter((item) => {
      // 快速仅看风险
      if (onlyRisks && item.status === 'new_measurement') {
        return false;
      }
      // 状态过滤
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      // 搜索
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const pid = (item.point_id ?? '').toLowerCase();
        const pname = (item.point_name ?? '').toLowerCase();
        const rname = (item.run_name ?? '').toLowerCase();
        const msg = (item.message ?? '').toLowerCase();
        if (!pid.includes(q) && !pname.includes(q) && !rname.includes(q) && !msg.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [preview.items, statusFilter, searchQuery, onlyRisks]);

  // 分页数据
  const totalPages = Math.ceil(filteredItems.length / pageSize) || 1;
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, currentPage, pageSize]);

  // 当筛选变化时重置页码
  const handleFilterChange = (status: string) => {
    setStatusFilter(status);
    setCurrentPage(1);
  };

  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    setCurrentPage(1);
  };

  return (
    <div>
      {/* ── 步骤向导 ── */}
      <div className="import-wizard-steps">
        <div className="wizard-step completed">
          <span className="wizard-step-num"><Check size={14} /></span>
          <span>1. 解析 XLSX 文件</span>
        </div>
        <div className="wizard-step-divider active" />
        <div className="wizard-step active">
          <span className="wizard-step-num">2</span>
          <span>2. 全宽数据预览与策略配置</span>
        </div>
        <div className="wizard-step-divider" />
        <div className="wizard-step">
          <span className="wizard-step-num">3</span>
          <span>3. 确认与写入后端</span>
        </div>
        <div className="wizard-step-divider" />
        <div className="wizard-step">
          <span className="wizard-step-num">4</span>
          <span>4. 导入完成</span>
        </div>
      </div>

      {/* ── 顶部 Header Banner ── */}
      <div className="preview-topbar-redesigned">
        <div className="preview-file-info">
          <div className="preview-file-icon">
            <FileSpreadsheet size={24} />
          </div>
          <div className="preview-file-details">
            <h3>数据预览 — {preview.filename}</h3>
            <div className="preview-file-meta">
              <span className="preview-file-tag">总记录: {preview.total_rows} 行</span>
              <span className="preview-file-tag">循环次数: {preview.cycle_counts.join(', ') || '—'}</span>
              {preview.can_confirm ? (
                <span style={{ color: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                  <CheckCircle2 size={15} /> 校验成功，就绪
                </span>
              ) : (
                <span style={{ color: '#dc2626', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                  <ShieldAlert size={15} /> 需解决异常
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="preview-topbar-actions">
          <button className="button" onClick={onCancel}>取消</button>
          <button
            className="button primary"
            disabled={!preview.can_confirm}
            onClick={onConfirm}
            style={{ padding: '8px 18px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Zap size={16} /> 确认并开始导入
          </button>
        </div>
      </div>

      {!preview.can_confirm && (
        <div className="alert danger" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <XCircle size={18} />
          <span>存在无法导入的问题（如未知点位或格式错误），请修正文件或在右侧开启跳过/更换策略。</span>
        </div>
      )}

      {/* ── KPI 核心指标卡片组 ── */}
      <div className="preview-kpi-grid">
        <div className="preview-kpi-card kpi-ok">
          <div className="preview-kpi-header">
            <span className="preview-kpi-title">文件概况</span>
            <FileText size={16} className="preview-kpi-icon" />
          </div>
          <div className="preview-kpi-body">
            <span className="preview-kpi-main-val">{preview.valid_rows} <small style={{ fontSize: 13, fontWeight: 400, color: '#64748b' }}>/ {preview.total_rows} 行有效</small></span>
            <div className="preview-kpi-sub">
              <span>无效格式行</span>
              <strong style={{ color: preview.invalid_rows > 0 ? '#dc2626' : '#64748b' }}>{preview.invalid_rows}</strong>
            </div>
          </div>
        </div>

        <div className="preview-kpi-card kpi-ok">
          <div className="preview-kpi-header">
            <span className="preview-kpi-title">测试轮次变动</span>
            <Layers size={16} className="preview-kpi-icon" />
          </div>
          <div className="preview-kpi-body">
            <span className="preview-kpi-main-val">+{preview.new_run_count} <small style={{ fontSize: 13, fontWeight: 400, color: '#64748b' }}>个新轮次</small></span>
            <div className="preview-kpi-sub">
              <span>涉及已有轮次</span>
              <strong>{preview.existing_run_count}</strong>
            </div>
          </div>
        </div>

        <div className={`preview-kpi-card ${strategy === 'overwrite' && preview.will_update_count > 0 ? 'kpi-warn' : 'kpi-ok'}`}>
          <div className="preview-kpi-header">
            <span className="preview-kpi-title">测量记录预估</span>
            <Zap size={16} className="preview-kpi-icon" />
          </div>
          <div className="preview-kpi-body">
            <span className="preview-kpi-main-val">+{preview.new_measurement_count} <small style={{ fontSize: 13, fontWeight: 400, color: '#64748b' }}>条新增</small></span>
            <div className="preview-kpi-sub">
              <span>{strategy === 'overwrite' ? '将覆盖更新' : '涉及已有记录'}</span>
              <strong style={{ color: strategy === 'overwrite' && preview.will_update_count > 0 ? '#d97706' : '#64748b' }}>
                {strategy === 'overwrite' ? preview.will_update_count : preview.existing_measurement_count}
              </strong>
            </div>
          </div>
        </div>

        <div className={`preview-kpi-card ${hasIssues ? 'kpi-danger' : 'kpi-ok'}`}>
          <div className="preview-kpi-header">
            <span className="preview-kpi-title">风险/冲突提醒</span>
            <ShieldAlert size={16} className="preview-kpi-icon" />
          </div>
          <div className="preview-kpi-body">
            <span className="preview-kpi-main-val" style={{ color: hasIssues ? '#dc2626' : '#16a34a' }}>
              {preview.unknown_point_count + preview.file_duplicate_count + preview.invalid_rows} <small style={{ fontSize: 13, fontWeight: 400, color: '#64748b' }}>处待处理</small>
            </span>
            <div className="preview-kpi-sub">
              <span>未知点位/文件内重复</span>
              <strong>{preview.unknown_point_count} / {preview.file_duplicate_count}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* ── 新增：数据分布占比堆叠看板 (Status Distribution Panel) ── */}
      <div className="status-distribution-panel">
        <div className="distribution-header">
          <span>📊 XLSX 数据行状态构成占比</span>
          <span style={{ fontSize: 12, fontWeight: 400, color: '#64748b' }}>全量解析预览占比</span>
        </div>
        <div className="stacked-bar-container">
          {distributionPercentages.new_pct > 0 && (
            <div className="stacked-segment seg-new" style={{ width: `${distributionPercentages.new_pct}%` }} title={`待新增: ${counts.new_measurement} 条 (${distributionPercentages.new_pct.toFixed(1)}%)`} />
          )}
          {distributionPercentages.exist_pct > 0 && (
            <div className="stacked-segment seg-exist" style={{ width: `${distributionPercentages.exist_pct}%` }} title={`已有记录: ${counts.existing_measurement} 条 (${distributionPercentages.exist_pct.toFixed(1)}%)`} />
          )}
          {distributionPercentages.dup_pct > 0 && (
            <div className="stacked-segment seg-dup" style={{ width: `${distributionPercentages.dup_pct}%` }} title={`文件重复: ${counts.file_duplicate} 条 (${distributionPercentages.dup_pct.toFixed(1)}%)`} />
          )}
          {distributionPercentages.unknown_pct > 0 && (
            <div className="stacked-segment seg-unknown" style={{ width: `${distributionPercentages.unknown_pct}%` }} title={`未知点位: ${counts.unknown_point} 条 (${distributionPercentages.unknown_pct.toFixed(1)}%)`} />
          )}
          {distributionPercentages.invalid_pct > 0 && (
            <div className="stacked-segment seg-invalid" style={{ width: `${distributionPercentages.invalid_pct}%` }} title={`无效格式: ${counts.invalid} 条 (${distributionPercentages.invalid_pct.toFixed(1)}%)`} />
          )}
        </div>
        <div className="distribution-legend">
          <div className="legend-item"><span className="legend-dot seg-new" /><span>待新增: {counts.new_measurement}</span></div>
          <div className="legend-item"><span className="legend-dot seg-exist" /><span>已有记录: {counts.existing_measurement}</span></div>
          {counts.file_duplicate > 0 && <div className="legend-item"><span className="legend-dot seg-dup" /><span>文件重复: {counts.file_duplicate}</span></div>}
          {counts.unknown_point > 0 && <div className="legend-item"><span className="legend-dot seg-unknown" /><span>未知点位: {counts.unknown_point}</span></div>}
          {counts.invalid > 0 && <div className="legend-item"><span className="legend-dot seg-invalid" /><span>无效格式: {counts.invalid}</span></div>}
        </div>
      </div>

      {/* ── 主内容区：两栏 ── */}
      <div className="preview-main">
        {/* ── 左栏：筛选工具栏 + 明细表格 + 分页 ── */}
        <div className="preview-left">
          {/* 筛选与搜查工具栏 */}
          <div className="preview-filter-bar">
            <div className="status-tabs">
              <button
                className={`status-tab-btn ${statusFilter === 'all' && !onlyRisks ? 'active' : ''}`}
                onClick={() => { setOnlyRisks(false); handleFilterChange('all'); }}
              >
                全部 <span className="status-tab-count">{counts.all}</span>
              </button>
              {counts.new_measurement > 0 && (
                <button
                  className={`status-tab-btn ${statusFilter === 'new_measurement' && !onlyRisks ? 'active' : ''}`}
                  onClick={() => { setOnlyRisks(false); handleFilterChange('new_measurement'); }}
                >
                  待新增 <span className="status-tab-count">{counts.new_measurement}</span>
                </button>
              )}
              {counts.existing_measurement > 0 && (
                <button
                  className={`status-tab-btn ${statusFilter === 'existing_measurement' && !onlyRisks ? 'active' : ''}`}
                  onClick={() => { setOnlyRisks(false); handleFilterChange('existing_measurement'); }}
                >
                  已有记录 <span className="status-tab-count">{counts.existing_measurement}</span>
                </button>
              )}
              {counts.unknown_point > 0 && (
                <button
                  className={`status-tab-btn ${statusFilter === 'unknown_point' && !onlyRisks ? 'active' : ''}`}
                  onClick={() => { setOnlyRisks(false); handleFilterChange('unknown_point'); }}
                  style={{ color: '#dc2626' }}
                >
                  未知点位 <span className="status-tab-count" style={{ background: '#fee2e2', color: '#dc2626' }}>{counts.unknown_point}</span>
                </button>
              )}
              {counts.file_duplicate > 0 && (
                <button
                  className={`status-tab-btn ${statusFilter === 'file_duplicate' && !onlyRisks ? 'active' : ''}`}
                  onClick={() => { setOnlyRisks(false); handleFilterChange('file_duplicate'); }}
                  style={{ color: '#d97706' }}
                >
                  文件重复 <span className="status-tab-count" style={{ background: '#fef3c7', color: '#d97706' }}>{counts.file_duplicate}</span>
                </button>
              )}
              {counts.invalid > 0 && (
                <button
                  className={`status-tab-btn ${statusFilter === 'invalid' && !onlyRisks ? 'active' : ''}`}
                  onClick={() => { setOnlyRisks(false); handleFilterChange('invalid'); }}
                  style={{ color: '#dc2626' }}
                >
                  无效行 <span className="status-tab-count" style={{ background: '#fee2e2', color: '#dc2626' }}>{counts.invalid}</span>
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label className="checkbox-label" style={{ fontSize: 12, color: '#475569' }}>
                <input
                  type="checkbox"
                  checked={onlyRisks}
                  onChange={(e) => { setOnlyRisks(e.target.checked); setCurrentPage(1); }}
                />
                只看风险与冲突
              </label>
              <div className="preview-search-box">
                <Search size={14} />
                <input
                  type="text"
                  placeholder="搜索点位/轮次/说明..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* 全宽扩展数据明细表格 wrap */}
          <div className="table-wrap preview-table-wrap">
            <table className="entry-table preview-table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>行</th>
                  <th style={{ width: 96 }}>状态</th>
                  <th style={{ width: 110 }}>轮次名称</th>
                  <th style={{ width: 75 }}>循环</th>
                  <th style={{ width: 130 }}>测试时间</th>
                  <th style={{ width: 75 }}>点位ID</th>
                  <th>点位名称</th>
                  <th style={{ width: 95 }}>max με</th>
                  <th style={{ width: 95 }}>min με</th>
                  {hasExisting && <th style={{ width: 120 }}>已有 max / min</th>}
                  <th>校验说明</th>
                </tr>
              </thead>
              <tbody>
                {paginatedItems.length === 0 ? (
                  <tr>
                    <td colSpan={hasExisting ? 11 : 10} style={{ textAlign: 'center', padding: 36, color: '#94a3b8' }}>
                      没有满足筛选条件的记录
                    </td>
                  </tr>
                ) : (
                  paginatedItems.map((item) => {
                    // 计算数值对比差值 Tag
                    let maxDiff: number | null = null;
                    if (item.status === 'existing_measurement' && item.max_strain_ue != null && item.existing_max_strain_ue != null) {
                      maxDiff = Number((item.max_strain_ue - item.existing_max_strain_ue).toFixed(1));
                    }

                    return (
                      <tr key={item.row_index} className={
                        item.status === 'invalid' || item.status === 'unknown_point' ? 'row-danger' :
                        item.status === 'file_duplicate' ? 'row-warn' :
                        item.status === 'existing_measurement' ? 'row-warn' : ''
                      }>
                        <td className="cell-num" style={{ color: '#64748b' }}>{item.row_index}</td>
                        <td><StatusBadge status={item.status} /></td>
                        <td style={{ fontSize: 12, color: '#475569' }}>{item.run_name ?? '—'}</td>
                        <td className="cell-num">{item.cycle_count != null ? item.cycle_count.toLocaleString() : '—'}</td>
                        <td style={{ fontSize: 11, color: '#64748b' }}>{item.test_time ? item.test_time.split('T')[0] : '—'}</td>
                        <td className="cell-num" style={{ fontWeight: 600, color: '#334155' }}>{item.point_id ?? '—'}</td>
                        <td>{item.point_name ?? '—'}</td>
                        <td className="cell-num">
                          {item.max_strain_ue != null ? (
                            <span>
                              {item.max_strain_ue.toFixed(1)}
                              {maxDiff !== null && maxDiff !== 0 && (
                                <span className={`diff-tag ${maxDiff > 0 ? 'pos' : 'neg'}`}>
                                  {maxDiff > 0 ? `+${maxDiff}` : maxDiff}
                                </span>
                              )}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="cell-num">{item.min_strain_ue != null ? item.min_strain_ue.toFixed(1) : '—'}</td>
                        {hasExisting && (
                          <td className="cell-num" style={{ fontSize: 11, color: '#64748b' }}>
                            {item.existing_max_strain_ue != null ? `${item.existing_max_strain_ue.toFixed(1)} / ${item.existing_min_strain_ue?.toFixed(1) ?? '—'}` : '—'}
                          </td>
                        )}
                        <td className="cell-msg">{item.message ?? ''}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 分页与条数控制面板 */}
          <div className="preview-pagination">
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div className="page-size-selector">
                <span>每页显示:</span>
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}>
                  <option value={15}>15 条</option>
                  <option value={20}>20 条</option>
                  <option value={30}>30 条</option>
                  <option value={50}>50 条</option>
                  <option value={100}>100 条</option>
                </select>
              </div>
              <span>
                显示第 {filteredItems.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, filteredItems.length)} 条，共 {filteredItems.length} 条
              </span>
            </div>
            <div className="pagination-controls">
              <button
                className="pagination-btn"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              >
                上一页
              </button>
              <span style={{ margin: '0 6px', fontWeight: 600, color: '#334155' }}>
                {currentPage} / {totalPages}
              </span>
              <button
                className="pagination-btn"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              >
                下一页
              </button>
            </div>
          </div>
        </div>

        {/* ── 右栏：智能助手卡片 + 策略选择 + 校验说明 + 高级选项 ── */}
        <div className="preview-right">
          {/* 智能助手一键修复面板 */}
          {preview.unknown_point_count > 0 && !skipUnknownPoints && (
            <div className="smart-fix-card">
              <div className="smart-fix-header">
                <AlertTriangle size={16} />
                <span>发现 {preview.unknown_point_count} 个未知点位</span>
              </div>
              <div className="smart-fix-body">
                这些点位不存在于当前项目中。开启“跳过未知点位”后可直接导入其余正常数据。
              </div>
              <div className="smart-fix-action">
                <button className="button small primary" onClick={() => onSkipUnknownPointsChange(true)}>
                  一键开启“跳过未知点位”
                </button>
              </div>
            </div>
          )}

          {preview.file_duplicate_count > 0 && !skipFileDuplicates && (
            <div className="smart-fix-card" style={{ background: 'linear-gradient(135deg, #fefce8 0%, #fef9c3 100%)', borderColor: '#fde047' }}>
              <div className="smart-fix-header" style={{ color: '#a16207' }}>
                <AlertTriangle size={16} />
                <span>发现 {preview.file_duplicate_count} 行文件内重复</span>
              </div>
              <div className="smart-fix-body" style={{ color: '#854d0e' }}>
                文件中同一点位和循环次数出现多次。开启“跳过文件内重复行”可忽略后出现的重复数据。
              </div>
              <div className="smart-fix-action">
                <button className="button small primary" onClick={() => onSkipFileDuplicatesChange(true)}>
                  一键开启“跳过文件内重复”
                </button>
              </div>
            </div>
          )}

          {/* 策略选择 V2 */}
          <div className="preview-card">
            <h4><Layers size={16} /> 导入策略配置</h4>
            <div style={{ marginTop: 10 }}>
              {STRATEGY_OPTIONS.map((opt) => {
                const isSelected = strategy === opt.value;
                return (
                  <div
                    key={opt.value}
                    className={`strategy-card-v2 ${isSelected ? 'selected' : ''}`}
                    onClick={() => onStrategyChange(opt.value)}
                  >
                    <div className="strategy-card-icon">
                      {isSelected ? <Check size={18} /> : <Zap size={16} />}
                    </div>
                    <div className="strategy-card-content">
                      <div className="strategy-card-title">
                        <span>{opt.label}</span>
                      </div>
                      <p className="strategy-card-desc">{opt.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 校验问题与警告列表 */}
          {(preview.errors.length > 0 || preview.warnings.length > 0) && (
            <div className="preview-card">
              <h4><ShieldAlert size={16} /> 详细校验结果</h4>
              {preview.errors.length > 0 && (
                <div className="preview-issue-list">
                  {preview.errors.map((e, i) => (
                    <div key={i} className="preview-issue error">
                      <XCircle size={14} />
                      <span>第 {e.row} 行 — {e.message}</span>
                    </div>
                  ))}
                </div>
              )}
              {preview.warnings.length > 0 && (
                <div className="preview-issue-list">
                  {preview.warnings.slice(0, 10).map((w, i) => (
                    <div key={i} className="preview-issue warning">
                      <AlertTriangle size={14} />
                      <span>第 {w.row} 行 — {w.message}</span>
                    </div>
                  ))}
                  {preview.warnings.length > 10 && (
                    <p className="hint">... 还有 {preview.warnings.length - 10} 条警告</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 高级选项面板 */}
          <div className="preview-card">
            <button className="button small" onClick={onToggleAdvanced} style={{ width: '100%', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>高级处理选项</span>
              {showAdvanced ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {showAdvanced && (
              <div className="advanced-body">
                <label className="checkbox-label">
                  <input type="checkbox" checked={updateRunMeta} onChange={(e) => onUpdateRunMetaChange(e.target.checked)} />
                  更新已有轮次名称与测试时间
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" checked={skipUnknownPoints} onChange={(e) => onSkipUnknownPointsChange(e.target.checked)} />
                  跳过未知点位
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" checked={skipFileDuplicates} onChange={(e) => onSkipFileDuplicatesChange(e.target.checked)} />
                  跳过文件内重复行
                </label>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 导入结果面板 ──
function XlsxResultPanel({ result, onDone, onRetry }: { result: XlsxImportResult; onDone: () => void; onRetry: () => void }) {
  return (
    <div>
      <div className="section-head">
        <div>
          <h2>{result.success ? '导入完成' : '导入失败'}</h2>
          <p>{result.message}</p>
        </div>
      </div>

      {result.success && (
        <div className="preview-stats">
          <div className="stat-item ok"><span className="stat-label">策略</span><span className="stat-value">{STRATEGY_OPTIONS.find(o => o.value === result.strategy)?.label || result.strategy}</span></div>
          <div className="stat-item ok"><span className="stat-label">新增轮次</span><span className="stat-value">{result.created_run_count}</span></div>
          <div className="stat-item ok"><span className="stat-label">新增记录</span><span className="stat-value">{result.created_measurement_count}</span></div>
          {result.updated_measurement_count > 0 && (
            <div className="stat-item warn"><span className="stat-label">覆盖记录</span><span className="stat-value">{result.updated_measurement_count}</span></div>
          )}
          {result.filled_missing_count > 0 && (
            <div className="stat-item ok"><span className="stat-label">填补字段</span><span className="stat-value">{result.filled_missing_count}</span></div>
          )}
          {result.skipped_existing_count > 0 && (
            <div className="stat-item"><span className="stat-label">跳过已有</span><span className="stat-value">{result.skipped_existing_count}</span></div>
          )}
          {result.skipped_invalid_count > 0 && (
            <div className="stat-item danger"><span className="stat-label">跳过无效</span><span className="stat-value">{result.skipped_invalid_count}</span></div>
          )}
          {result.skipped_unknown_point_count > 0 && (
            <div className="stat-item danger"><span className="stat-label">跳过未知点位</span><span className="stat-value">{result.skipped_unknown_point_count}</span></div>
          )}
          {result.skipped_file_duplicate_count > 0 && (
            <div className="stat-item danger"><span className="stat-label">跳过重复</span><span className="stat-value">{result.skipped_file_duplicate_count}</span></div>
          )}
        </div>
      )}

      <div className="import-actions" style={{ marginTop: 16 }}>
        <button className="button primary" onClick={onDone}>
          <CheckCircle size={18} /> 返回当前项目
        </button>
        <button className="button" onClick={onRetry}>继续导入</button>
      </div>
    </div>
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
  calc: (row: RowState) => { amplitude: number; stress: number | null } | null;
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
                <td>{value?.stress == null ? '-' : value.stress.toFixed(2)}</td>
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

import { FileSpreadsheet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { Point, TestRun } from '../types';

interface Props {
  projectId: number;
  points: Point[];
  onImported: () => void;
}

interface CsvRow {
  run_name: string;
  cycle_count: string;
  test_time: string;
  point_id: string;
  max_strain_ue: string;
  min_strain_ue: string;
  remark: string;
}

const REQUIRED_HEADERS = ['run_name', 'cycle_count', 'test_time', 'point_id', 'max_strain_ue', 'min_strain_ue'];

export function DebugCsvImporter({ projectId, points, onImported }: Props) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pointMap = useMemo(() => new Map(points.map((point) => [point.point_id, point])), [points]);

  async function importCsv(file?: File) {
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      validateRows(rows, pointMap);
      const groups = groupRows(rows);
      let measurementCount = 0;

      for (const group of groups) {
        const run = await api.post<TestRun>(`/api/projects/${projectId}/test-runs`, {
          run_name: group.run_name,
          cycle_count: Number(group.cycle_count),
          test_time: group.test_time || null,
          remark: `CSV debug import: ${file.name}`,
        });
        await api.post(`/api/test-runs/${run.id}/measurements`, {
          measurements: group.rows.map((row) => ({
            point_db_id: pointMap.get(row.point_id)!.id,
            max_strain_ue: row.max_strain_ue === '' ? null : Number(row.max_strain_ue),
            min_strain_ue: row.min_strain_ue === '' ? null : Number(row.min_strain_ue),
            remark: row.remark || null,
          })),
        });
        measurementCount += group.rows.length;
      }

      setMessage(`导入完成：${groups.length} 个测试轮次，${measurementCount} 条测量记录。`);
      onImported();
    } catch (err) {
      setMessage(`导入失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel debug-panel">
      <div className="section-head">
        <div>
          <h2>Debug CSV 测试数据导入</h2>
          <p>CSV 表头：run_name, cycle_count, test_time, point_id, max_strain_ue, min_strain_ue, remark</p>
        </div>
        <label className="button primary file-button">
          <FileSpreadsheet size={18} />
          {busy ? '导入中...' : '选择 CSV'}
          <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => importCsv(event.target.files?.[0])} />
        </label>
      </div>
      {message && <div className={message.startsWith('导入失败') ? 'alert danger' : 'alert ok'}>{message}</div>}
    </div>
  );
}

function parseCsv(text: string): CsvRow[] {
  const lines = splitCsvLines(text.replace(/^\uFEFF/, ''));
  if (lines.length < 2) throw new Error('CSV 至少需要表头和一行数据');
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  for (const header of REQUIRED_HEADERS) {
    if (!headers.includes(header)) throw new Error(`缺少表头: ${header}`);
  }
  return lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line, index) => {
      const cells = parseCsvLine(line);
      const row = Object.fromEntries(headers.map((header, i) => [header, cells[i]?.trim() ?? ''])) as Partial<CsvRow>;
      if (!row.remark) row.remark = '';
      if (!row.run_name || !row.cycle_count || !row.point_id) {
        throw new Error(`第 ${index + 2} 行缺少轮次、循环次数或点位编号`);
      }
      return row as CsvRow;
    });
}

function splitCsvLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function validateRows(rows: CsvRow[], pointMap: Map<string, Point>) {
  rows.forEach((row, index) => {
    if (!pointMap.has(row.point_id)) throw new Error(`第 ${index + 2} 行点位编号不存在: ${row.point_id}`);
    if (!Number.isFinite(Number(row.cycle_count))) throw new Error(`第 ${index + 2} 行循环次数不是数字`);
    if (row.max_strain_ue !== '' && !Number.isFinite(Number(row.max_strain_ue))) throw new Error(`第 ${index + 2} 行最大应变不是数字`);
    if (row.min_strain_ue !== '' && !Number.isFinite(Number(row.min_strain_ue))) throw new Error(`第 ${index + 2} 行最小应变不是数字`);
  });
}

function groupRows(rows: CsvRow[]) {
  const map = new Map<string, { run_name: string; cycle_count: string; test_time: string; rows: CsvRow[] }>();
  rows.forEach((row) => {
    const key = `${row.run_name}::${row.cycle_count}::${row.test_time}`;
    const group = map.get(key) ?? { run_name: row.run_name, cycle_count: row.cycle_count, test_time: row.test_time, rows: [] };
    group.rows.push(row);
    map.set(key, group);
  });
  return Array.from(map.values()).sort((a, b) => Number(a.cycle_count) - Number(b.cycle_count));
}

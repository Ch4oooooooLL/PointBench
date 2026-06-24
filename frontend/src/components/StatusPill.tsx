export function StatusPill({ value, tone = 'neutral' }: { value?: string | boolean | null; tone?: 'neutral' | 'ok' | 'warn' | 'danger' }) {
  const text = typeof value === 'boolean' ? (value ? '异常' : '正常') : value || '-';
  return <span className={`pill ${tone}`}>{text}</span>;
}

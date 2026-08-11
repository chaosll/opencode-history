export function fmtK(n: number): string {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
  return String(Math.round(v));
}

export function fmtCost(n: number | undefined): string {
  const v = Number(n) || 0;
  if (v <= 0) return '—';
  if (v < 0.01) return '$<0.01';
  return '$' + v.toFixed(2);
}

export function fmtTime(ts: number | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtTimeShort(ts: number | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function relTime(ts: number): string {
  const diff = Date.now() - (Number(ts) || 0);
  const min = 60_000, hour = 3_600_000, day = 86_400_000;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return fmtTime(ts);
}

export function fmtDuration(start: number | undefined, end: number | undefined): string {
  if (!start || !end) return '';
  const s = Math.max(0, Math.round((end - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m${r}s`;
}

export function modelLabel(modelId: string | undefined, model: { providerID?: string; id?: string; variant?: string } | undefined): string {
  if (model?.providerID && model.id) {
    const name = `${model.providerID}/${model.id}`;
    return model.variant && model.variant !== 'default' ? `${name} (${model.variant})` : name;
  }
  return modelId || '—';
}

export function modelLabelFromDb(model: string | null | undefined): string {
  if (!model) return '—';
  const t = model.trim();
  if (t.startsWith('{')) {
    try {
      return modelLabel(undefined, JSON.parse(t) as { providerID?: string; id?: string; variant?: string });
    } catch {
      return model;
    }
  }
  return model;
}
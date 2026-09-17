import type { Cue, Issue, Settings } from './types';

/**
 * 扫描当前全部 cue，生成问题清单：
 *  - negative：开始/结束时间非法
 *  - duration：短于最小时长
 *  - overlap：相邻片段重叠（错误）
 *  - gap：相邻片段间隔小于最小间隔（警告）
 * 检测基于按 start 排序后的相邻对。
 */
export function detectIssues(cuesInput: Cue[], settings: Settings): Issue[] {
  const issues: Issue[] = [];
  const cues = [...cuesInput].sort((a, b) => a.start - b.start || a.end - b.end);

  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.start < -0.0005 || c.end < -0.0005 || c.end <= c.start) {
      issues.push({
        key: `neg-${c.id}`,
        kind: 'negative',
        severity: 'error',
        message: `片段 #${i + 1} 时间非法（${c.start.toFixed(2)}s → ${c.end.toFixed(2)}s），结束必须晚于开始且不能为负。`,
        cueIds: [c.id],
        range: [Math.max(0, c.start), Math.max(c.end, c.start)],
      });
      continue;
    }
    if (c.end - c.start + 0.0005 < settings.minDuration) {
      issues.push({
        key: `dur-${c.id}`,
        kind: 'duration',
        severity: 'warning',
        message: `片段 #${i + 1} 时长 ${(c.end - c.start).toFixed(2)}s，短于最小时长 ${settings.minDuration.toFixed(2)}s。`,
        cueIds: [c.id],
        range: [c.start, c.end],
      });
    }
  }

  for (let i = 0; i + 1 < cues.length; i++) {
    const a = cues[i];
    const b = cues[i + 1];
    const valid = a.end > a.start && b.end > b.start;
    if (!valid) continue;

    if (b.start < a.end - 0.0005) {
      issues.push({
        key: `ov-${a.id}-${b.id}`,
        kind: 'overlap',
        severity: 'error',
        message: `片段 #${i + 1} 与 #${i + 2} 重叠 ${(a.end - b.start).toFixed(2)}s。`,
        cueIds: [a.id, b.id],
        range: [b.start, a.end],
      });
    } else if (b.start - a.end + 0.0005 < settings.minGap) {
      issues.push({
        key: `gap-${a.id}-${b.id}`,
        kind: 'gap',
        severity: 'warning',
        message: `片段 #${i + 1} 与 #${i + 2} 间隔仅 ${(b.start - a.end).toFixed(2)}s，小于最小间隔 ${settings.minGap.toFixed(2)}s。`,
        cueIds: [a.id, b.id],
        range: [a.end, b.start],
      });
    }
  }

  return issues;
}

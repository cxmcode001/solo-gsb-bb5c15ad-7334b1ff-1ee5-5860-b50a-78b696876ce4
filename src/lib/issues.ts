import type { Cue, Issue, Settings } from './types';
import { computeCueBox, hasLayoutSettings, parseLayoutSettings, safeAreaViolations } from './layout';

/**
 * 扫描当前全部 cue，生成问题清单：
 * 时序：
 *  - negative：开始/结束时间非法
 *  - duration：短于最小时长
 *  - overlap：相邻片段重叠（错误）
 *  - gap：相邻片段间隔小于最小间隔（警告）
 * 画面布局：
 *  - layout：line / position / size / align 设置非法（错误）
 *  - safearea：字幕框越出 10% 安全区（警告，仅检测显式设置了布局字段的片段）
 * 时序检测基于按 start 排序后的相邻对。
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

  // 画面布局检测：非法布局值（错误）与字幕框越出 10% 安全区（警告）
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (!c.settings.trim()) continue;
    const parsed = parseLayoutSettings(c.settings);
    const range: [number, number] = [Math.max(0, c.start), Math.max(c.end, c.start)];
    if (parsed.errors.length > 0) {
      issues.push({
        key: `layout-${c.id}`,
        kind: 'layout',
        severity: 'error',
        message: `片段 #${i + 1} 的布局设置非法：${parsed.errors.map((e) => `${e.key}:"${e.raw}"（${e.reason}）`).join('；')}。`,
        cueIds: [c.id],
        range,
      });
    }
    if (hasLayoutSettings(c.settings)) {
      const violations = safeAreaViolations(computeCueBox(c, parsed.layout));
      if (violations.length > 0) {
        issues.push({
          key: `safe-${c.id}`,
          kind: 'safearea',
          severity: 'warning',
          message: `片段 #${i + 1} 的字幕框越出 10% 安全区（${violations.join('、')}侧）。`,
          cueIds: [c.id],
          range,
        });
      }
    }
  }

  return issues;
}

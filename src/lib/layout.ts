import type { Cue } from './types';

/**
 * 画面布局：解析 WebVTT cue 设置中的 line / position / size / align 四个字段，
 * 估算字幕框在 16:9 画面中的位置（百分比坐标），用于布局预览与 10% 安全区检查。
 * 其余 cue 设置（vertical / region / 自定义字段等）不参与解析，始终原样保留。
 */

export type LayoutKey = 'line' | 'position' | 'size' | 'align';

export type LineAlign = 'start' | 'center' | 'end';
export type PositionAlign = 'line-left' | 'center' | 'line-right';
export type TextAlign = 'start' | 'center' | 'end' | 'left' | 'right';

export interface LineValue {
  /** 百分比模式：距画面顶部的百分比（0–100） */
  percent?: number;
  /** 行号模式：非负从顶部数、负数从底部数（-1 = 最底行） */
  lineNumber?: number;
  align?: LineAlign;
}

export interface PositionValue {
  percent: number;
  align?: PositionAlign;
}

export interface LayoutSettings {
  line?: LineValue;
  position?: PositionValue;
  /** 字幕框宽度，占画面宽度的百分比 */
  size?: number;
  /** align:middle 归一化为 center */
  align?: TextAlign;
}

export interface LayoutError {
  key: LayoutKey;
  raw: string;
  reason: string;
}

export interface LayoutParse {
  layout: LayoutSettings;
  errors: LayoutError[];
}

/** WebVTT 规范行高：视频高度的 5.33% */
export const LINE_HEIGHT_PCT = 5.33;
/** 安全区：画面四边各内缩 10% */
export const SAFE_MARGIN_PCT = 10;

const PERCENT_RE = /^(-?\d+(?:\.\d+)?)%$/;
const INT_RE = /^-?\d+$/;
const LAYOUT_KEYS: string[] = ['line', 'position', 'size', 'align'];

function splitTokens(settings: string): string[] {
  return settings.split(/\s+/).filter((t) => t.length > 0);
}

function tokenKey(token: string): string {
  const c = token.indexOf(':');
  return c > 0 ? token.slice(0, c) : '';
}

/** 取出某个布局字段的原始值（不含 "key:" 前缀），未设置时返回空串 */
export function getLayoutRaw(settings: string, key: LayoutKey): string {
  for (const token of splitTokens(settings)) {
    if (tokenKey(token) === key) return token.slice(token.indexOf(':') + 1);
  }
  return '';
}

/** 设置中是否显式包含任一布局字段 */
export function hasLayoutSettings(settings: string): boolean {
  return splitTokens(settings).some((t) => LAYOUT_KEYS.includes(tokenKey(t)));
}

/**
 * 更新某个布局字段，其余设置（含未知字段）保持原始顺序与内容：
 * - 已存在 → 原位替换；不存在 → 追加到末尾；value 为空 → 删除该字段。
 */
export function updateCueSettings(settings: string, key: LayoutKey, value: string): string {
  const tokens = splitTokens(settings);
  const v = value.trim();
  const idx = tokens.findIndex((t) => tokenKey(t) === key);
  if (v === '') {
    if (idx >= 0) tokens.splice(idx, 1);
  } else if (idx >= 0) {
    tokens[idx] = `${key}:${v}`;
  } else {
    tokens.push(`${key}:${v}`);
  }
  return tokens.join(' ');
}

function parsePercent(raw: string): number | null {
  const m = PERCENT_RE.exec(raw);
  return m ? Number(m[1]) : null;
}

/** 解析四个布局字段；非法值记入 errors（该字段按未设置处理），未知字段忽略 */
export function parseLayoutSettings(settings: string): LayoutParse {
  const layout: LayoutSettings = {};
  const errors: LayoutError[] = [];
  const seen = new Set<string>();

  for (const token of splitTokens(settings)) {
    const key = tokenKey(token);
    if (seen.has(key)) continue;
    const raw = token.slice(token.indexOf(':') + 1);

    if (key === 'line') {
      seen.add(key);
      const parts = raw.split(',');
      const [main, sub] = parts;
      if (main === '' || parts.length > 2) {
        errors.push({ key, raw, reason: '格式应为 line:<百分比|行号>[,start|center|end]' });
        continue;
      }
      let align: LineAlign | undefined;
      if (sub !== undefined) {
        if (sub === 'start' || sub === 'center' || sub === 'end') align = sub;
        else {
          errors.push({ key, raw, reason: sub === '' ? '行对齐值缺失' : `未知的行对齐“${sub}”` });
          continue;
        }
      }
      const pct = parsePercent(main);
      if (pct !== null) {
        if (pct < 0 || pct > 100) {
          errors.push({ key, raw, reason: '百分比须在 0–100 之间' });
        } else {
          layout.line = { percent: pct, align };
        }
      } else if (INT_RE.test(main)) {
        layout.line = { lineNumber: Number(main), align };
      } else {
        errors.push({ key, raw, reason: '应为百分比（如 90%）或行号（如 -1）' });
      }
    } else if (key === 'position') {
      seen.add(key);
      const parts = raw.split(',');
      const [main, sub] = parts;
      if (main === '' || parts.length > 2) {
        errors.push({ key, raw, reason: '格式应为 position:<百分比>[,line-left|center|line-right]' });
        continue;
      }
      let align: PositionAlign | undefined;
      if (sub !== undefined) {
        if (sub === 'line-left' || sub === 'center' || sub === 'line-right') align = sub;
        else {
          errors.push({ key, raw, reason: sub === '' ? '位置对齐值缺失' : `未知的位置对齐“${sub}”` });
          continue;
        }
      }
      const pct = parsePercent(main);
      if (pct === null || pct < 0 || pct > 100) {
        errors.push({ key, raw, reason: '应为 0–100 的百分比（如 50%）' });
      } else {
        layout.position = { percent: pct, align };
      }
    } else if (key === 'size') {
      seen.add(key);
      const pct = parsePercent(raw);
      if (pct === null || pct < 0 || pct > 100) {
        errors.push({ key, raw, reason: '应为 0–100 的百分比（如 60%）' });
      } else {
        layout.size = pct;
      }
    } else if (key === 'align') {
      seen.add(key);
      if (raw === 'middle') {
        layout.align = 'center';
      } else if (raw === 'start' || raw === 'center' || raw === 'end' || raw === 'left' || raw === 'right') {
        layout.align = raw;
      } else {
        errors.push({ key, raw, reason: '应为 start / center / middle / end / left / right' });
      }
    }
    // vertical / region / 未知字段：不参与布局解析，原样保留
  }
  return { layout, errors };
}

/** 字幕框（百分比坐标，相对 16:9 画面） */
export interface CueBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 字幕文本的有效行数（忽略空白行，至少 1 行） */
export function textLineCount(text: string): number {
  return Math.max(1, text.split('\n').filter((l) => l.trim().length > 0).length);
}

/**
 * 按 WebVTT 渲染规则估算字幕框：
 * - 宽 = size（默认 100%）；高 = 行数 × 5.33%（规范行高）；
 * - 水平：position（默认 50%）为锚点，锚定方式由位置对齐决定，
 *   未指定时随 align 推导（start/left→line-left，end/right→line-right，其余→center）；
 * - 垂直：line 百分比按行对齐放置；行号模式非负从顶数、负数从底数；缺省等同 line:-1（贴底）。
 */
export function computeCueBox(cue: Cue, layout: LayoutSettings): CueBox {
  const height = textLineCount(cue.text) * LINE_HEIGHT_PCT;
  const width = layout.size ?? 100;

  const posPct = layout.position?.percent ?? 50;
  const posAlign: PositionAlign = layout.position?.align
    ?? (layout.align === 'start' || layout.align === 'left'
      ? 'line-left'
      : layout.align === 'end' || layout.align === 'right'
        ? 'line-right'
        : 'center');
  const left = posAlign === 'line-left' ? posPct
    : posAlign === 'line-right' ? posPct - width
    : posPct - width / 2;

  let top: number;
  const line = layout.line;
  if (line?.percent !== undefined) {
    const la = line.align ?? 'start';
    top = la === 'center' ? line.percent - height / 2
      : la === 'end' ? line.percent - height
      : line.percent;
  } else if (line?.lineNumber !== undefined) {
    const n = line.lineNumber;
    top = n >= 0 ? n * LINE_HEIGHT_PCT : 100 + (n + 1) * LINE_HEIGHT_PCT - height;
  } else {
    top = 100 - height;
  }

  return { left, top, width, height };
}

const EPS = 0.05;

/** 字幕框越出 10% 安全区的方向列表；空数组 = 完全在安全区内 */
export function safeAreaViolations(box: CueBox): string[] {
  const out: string[] = [];
  if (box.left < SAFE_MARGIN_PCT - EPS) out.push('左');
  if (box.left + box.width > 100 - SAFE_MARGIN_PCT + EPS) out.push('右');
  if (box.top < SAFE_MARGIN_PCT - EPS) out.push('上');
  if (box.top + box.height > 100 - SAFE_MARGIN_PCT + EPS) out.push('下');
  return out;
}

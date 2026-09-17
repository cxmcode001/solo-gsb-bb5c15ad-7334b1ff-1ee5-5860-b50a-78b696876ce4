import type { Cue } from '../lib/types';
import { computeCueBox, parseLayoutSettings, safeAreaViolations } from '../lib/layout';

interface Props {
  cue: Cue | null;
  index: number; // 按 start 排序后的序号（1 起），仅显示用
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

/** 画面布局预览：16:9 画面中绘制所选片段的字幕框与 10% 安全区 */
export default function LayoutPreview({ cue, index }: Props) {
  const parsed = cue ? parseLayoutSettings(cue.settings) : null;
  const box = cue && parsed ? computeCueBox(cue, parsed.layout) : null;
  const errors = parsed?.errors ?? [];
  const violations = box ? safeAreaViolations(box) : [];
  const offscreen = box
    ? box.left >= 100 || box.left + box.width <= 0 || box.top >= 100 || box.top + box.height <= 0
    : false;

  const align = parsed?.layout.align;
  const textAlign = align === 'start' || align === 'left' ? 'left'
    : align === 'end' || align === 'right' ? 'right' : 'center';

  return (
    <section className="panel">
      <h2>
        画面布局预览
        <span className="muted small ml">16:9 · 虚线为 10% 安全区</span>
      </h2>
      <div className="preview-screen">
        <div className="safe-area">
          <span className="safe-area-label">安全区</span>
        </div>
        {cue && box && (
          <div
            className={
              'preview-cue-box'
              + (errors.length > 0 ? ' invalid' : '')
              + (violations.length > 0 ? ' outside' : '')
            }
            style={{
              left: `${box.left}%`,
              top: `${box.top}%`,
              width: `${box.width}%`,
              height: `${box.height}%`,
            }}
          >
            <span className="preview-cue-text" style={{ textAlign }}>
              {stripTags(cue.text)}
            </span>
          </div>
        )}
        {cue && offscreen && <div className="preview-note">字幕框完全在画面之外</div>}
        {!cue && <div className="preview-empty muted small">选择一个片段以预览画面布局</div>}
      </div>
      {cue && errors.length > 0 && (
        <p className="preview-msg error">
          ⛔ {errors.map((e) => `${e.key}:"${e.raw}" ${e.reason}`).join('；')}
        </p>
      )}
      {cue && errors.length === 0 && violations.length > 0 && (
        <p className="preview-msg warn">⚠️ 字幕框越出 10% 安全区（{violations.join('、')}侧）</p>
      )}
      {cue && errors.length === 0 && violations.length === 0 && box && (
        <p className="preview-msg muted small">
          片段 #{index} · 字幕框 左 {box.left.toFixed(1)}% · 上 {box.top.toFixed(1)}%
          · 宽 {box.width.toFixed(1)}% · 高 {box.height.toFixed(1)}%
        </p>
      )}
    </section>
  );
}

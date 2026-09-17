import type { Cue } from '../lib/types';
import { getLayoutRaw, parseLayoutSettings, updateCueSettings, type LayoutKey } from '../lib/layout';
import TimeCodeInput from './TimeCodeInput';

const ALIGN_OPTIONS = ['start', 'center', 'middle', 'end', 'left', 'right'];

interface Props {
  cue: Cue | null;
  index: number; // 按 start 排序后的序号（1 起），仅显示用
  onPatch: (id: string, patch: Partial<Cue>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

/** 选中片段的详细检查器：手动编辑时间码、文本、布局字段、设置、锁定 */
export default function Inspector({ cue, index, onPatch, onDelete, onDuplicate }: Props) {
  if (!cue) {
    return (
      <section className="panel">
        <h2>片段检查器</h2>
        <p className="muted small">在时间轴或下方列表中选择一个片段后，可在此精确编辑。</p>
      </section>
    );
  }

  const layoutParse = parseLayoutSettings(cue.settings);
  const layoutErrorOf = (key: LayoutKey) => layoutParse.errors.find((e) => e.key === key)?.reason;
  const alignRaw = getLayoutRaw(cue.settings, 'align');
  const setLayout = (key: LayoutKey, value: string) =>
    onPatch(cue.id, { settings: updateCueSettings(cue.settings, key, value) });

  return (
    <section className="panel inspector">
      <h2>
        片段 #{index}
        <span className="ml">
          <button className="mini" onClick={() => onDuplicate(cue.id)} title="复制一个相同片段">复制</button>
          <button className="mini danger" onClick={() => onDelete(cue.id)}>删除</button>
        </span>
      </h2>

      <div className="row">
        <label className="chk">
          <input
            type="checkbox"
            checked={cue.locked}
            onChange={(e) => onPatch(cue.id, { locked: e.target.checked })}
          />
          🔒 锁定（拖动其它片段时不得推动此片段）
        </label>
      </div>

      <div className="row time-row">
        <span>开始</span>
        <TimeCodeInput value={cue.start} disabled={cue.locked} onCommit={(v) => onPatch(cue.id, { start: v })} />
        <span className="muted">结束</span>
        <TimeCodeInput value={cue.end} disabled={cue.locked} onCommit={(v) => onPatch(cue.id, { end: v })} />
      </div>
      <div className="row muted small mono">时长 {(cue.end - cue.start).toFixed(3)}s</div>

      <div className="row">
        <label className="field-label">字幕文本（多行与内联标签都会保留）</label>
        <textarea
          className="cue-text-edit"
          rows={4}
          value={cue.text}
          onChange={(e) => onPatch(cue.id, { text: e.target.value })}
        />
      </div>

      <div className="row">
        <label className="field-label">画面布局（独立编辑，其余 cue 设置保持原始顺序与内容）</label>
        <div className="layout-grid">
          <span>line</span>
          <input
            className={`layout-input mono${layoutErrorOf('line') ? ' bad' : ''}`}
            value={getLayoutRaw(cue.settings, 'line')}
            placeholder="如 90% 或 -1"
            spellCheck={false}
            onChange={(e) => setLayout('line', e.target.value)}
          />
          <span>position</span>
          <input
            className={`layout-input mono${layoutErrorOf('position') ? ' bad' : ''}`}
            value={getLayoutRaw(cue.settings, 'position')}
            placeholder="如 50% 或 50%,line-left"
            spellCheck={false}
            onChange={(e) => setLayout('position', e.target.value)}
          />
          <span>size</span>
          <input
            className={`layout-input mono${layoutErrorOf('size') ? ' bad' : ''}`}
            value={getLayoutRaw(cue.settings, 'size')}
            placeholder="如 60%"
            spellCheck={false}
            onChange={(e) => setLayout('size', e.target.value)}
          />
          <span>align</span>
          <select
            className={`layout-select${layoutErrorOf('align') ? ' bad' : ''}`}
            value={alignRaw}
            onChange={(e) => setLayout('align', e.target.value)}
          >
            <option value="">（未设置）</option>
            {ALIGN_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            {alignRaw !== '' && !ALIGN_OPTIONS.includes(alignRaw) && (
              <option value={alignRaw}>{alignRaw}（无法识别）</option>
            )}
          </select>
        </div>
        {layoutParse.errors.length > 0 && (
          <p className="layout-error">
            ⛔ {layoutParse.errors.map((e) => `${e.key}:"${e.raw}" ${e.reason}`).join('；')}
          </p>
        )}
      </div>

      <div className="row">
        <label className="field-label">cue 设置（position / line / align 等，原样保留）</label>
        <input
          className="settings-input mono"
          value={cue.settings}
          placeholder="如：line:90% position:50% align:middle"
          onChange={(e) => onPatch(cue.id, { settings: e.target.value })}
        />
      </div>

      <div className="row">
        <label className="field-label">cue 标识符（可选）</label>
        <input
          className="settings-input mono"
          value={cue.identifier}
          onChange={(e) => onPatch(cue.id, { identifier: e.target.value })}
        />
      </div>
    </section>
  );
}

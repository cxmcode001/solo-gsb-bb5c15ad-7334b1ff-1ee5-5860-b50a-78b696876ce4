import type { Cue } from '../lib/types';
import TimeCodeInput from './TimeCodeInput';

interface Props {
  cue: Cue | null;
  index: number; // 按 start 排序后的序号（1 起），仅显示用
  onPatch: (id: string, patch: Partial<Cue>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

/** 选中片段的详细检查器：手动编辑时间码、文本、设置、锁定 */
export default function Inspector({ cue, index, onPatch, onDelete, onDuplicate }: Props) {
  if (!cue) {
    return (
      <section className="panel">
        <h2>片段检查器</h2>
        <p className="muted small">在时间轴或下方列表中选择一个片段后，可在此精确编辑。</p>
      </section>
    );
  }

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

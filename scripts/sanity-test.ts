import assert from 'node:assert';
import { parseTimecode, formatTimecode } from '../src/lib/time';
import { parseVTT, serializeVTT } from '../src/lib/vtt';
import { applyDrag } from '../src/lib/solver';
import { detectIssues } from '../src/lib/issues';
import {
  computeCueBox,
  getLayoutRaw,
  hasLayoutSettings,
  parseLayoutSettings,
  safeAreaViolations,
  updateCueSettings,
} from '../src/lib/layout';
import type { Cue } from '../src/lib/types';

let passed = 0;
function ok(name: string) { passed++; console.log('  ✓', name); }

interface TCue { id: string; s: number; e: number; l?: boolean }
function mk(spec: TCue[]): Cue[] {
  return spec.map((c) => ({
    id: c.id, identifier: '', start: c.s, end: c.e, text: `t-${c.id}`, settings: '', locked: !!c.l,
  }));
}
const get = (cs: Cue[], id: string) => cs.find((c) => c.id === id)!;

// ---------- 时间码 ----------
assert.strictEqual(parseTimecode('00:03.200'), 3.2);
assert.strictEqual(parseTimecode('01:02:03.456'), 3723.456);
assert.strictEqual(parseTimecode('00:03,200'), 3.2);
assert.strictEqual(parseTimecode('99:99.000'), null);
assert.strictEqual(formatTimecode(3.2), '00:03.200');
assert.strictEqual(formatTimecode(3723.456), '01:02:03.456');
ok('时间码解析/格式化');

// ---------- VTT 往返 ----------
const vtt = `WEBVTT

NOTE 请保留我

1
00:00.000 --> 00:02.500 line:90% position:50% align:middle
第一行
<b>第二行</b>

2
00:02.600 --> 00:05.000
你好
`;
const parsed = parseVTT(vtt);
assert.ok(!parsed.error, parsed.error);
assert.strictEqual(parsed.cues.length, 2);
assert.strictEqual(parsed.cues[0].identifier, '1');
assert.strictEqual(parsed.cues[0].settings, 'line:90% position:50% align:middle');
assert.strictEqual(parsed.cues[0].text, '第一行\n<b>第二行</b>');
assert.ok(parsed.preamble.some((p) => p.includes('请保留我')));
const out = serializeVTT(parsed.cues, parsed.preamble);
assert.ok(out.startsWith('WEBVTT\n'));
assert.ok(out.includes('NOTE 请保留我'));
assert.ok(out.includes('line:90% position:50% align:middle'));
assert.ok(out.includes('<b>第二行</b>'));
assert.ok(out.includes('00:00.000 --> 00:02.500'));
const reparsed = parseVTT(out);
assert.strictEqual(reparsed.cues.length, 2);
ok('VTT 解析/序列化保留文本、设置、标识符、NOTE');

// ---------- 求解器 ----------
const GAP = 0.1, MIN = 1;

// 1. 向右移动：推动后续片段，保持时长与间隔
{
  const cs = mk([{ id: 'a', s: 0, e: 2 }, { id: 'b', s: 2.1, e: 4 }]);
  const r = applyDrag({ cues: cs, targetId: 'a', op: 'move', desired: 1, minDuration: MIN, minGap: GAP });
  assert.ok(r.feasible);
  assert.deepStrictEqual([get(r.cues, 'a').start, get(r.cues, 'a').end], [1, 3]);
  assert.deepStrictEqual([get(r.cues, 'b').start, get(r.cues, 'b').end], [3.1, 5]);
  ok('右移推动后续片段');
}

// 2. 向右移动空间充足时不影响更远的片段
{
  const cs = mk([{ id: 'a', s: 0, e: 2 }, { id: 'b', s: 5, e: 6 }]);
  const r = applyDrag({ cues: cs, targetId: 'a', op: 'move', desired: 1, minDuration: MIN, minGap: GAP });
  assert.ok(r.feasible);
  assert.deepStrictEqual([get(r.cues, 'b').start, get(r.cues, 'b').end], [5, 6]);
  ok('空间充足时不推动');
}

// 3. 撞锁定片段，中间片段可压缩吸收 => 可行
{
  // a [0,3] b [3.1,6] dur 2.9 ; locked c [6.1,8]
  // a 右缘目标 4.9：b 刚性到 [5.0,7.9] 撞 c(6.1) => 压缩 b 为 [5.0,6.0]（dur 1）恰好可行
  const cs = mk([{ id: 'a', s: 0, e: 3 }, { id: 'b', s: 3.1, e: 6 }, { id: 'c', s: 6.1, e: 8, l: true }]);
  const r = applyDrag({ cues: cs, targetId: 'a', op: 'move', desired: 1.9, minDuration: MIN, minGap: GAP });
  assert.ok(r.feasible, r.conflict?.reason);
  const b = get(r.cues, 'b'), c = get(r.cues, 'c'), a = get(r.cues, 'a');
  assert.strictEqual(b.end - b.start >= 1 - 1e-6, true);
  assert.strictEqual(c.start, 6.1); // 锁定不动
  assert.strictEqual(b.end + GAP <= c.start + 1e-6, true);
  assert.strictEqual(a.end + GAP <= b.start + 1e-6, true);
  ok('撞锁定片段时中间片段压缩吸收');
}

// 3b. 同上场景，再多压一点即无解
{
  const cs = mk([{ id: 'a', s: 0, e: 3 }, { id: 'b', s: 3.1, e: 6 }, { id: 'c', s: 6.1, e: 8, l: true }]);
  const r = applyDrag({ cues: cs, targetId: 'a', op: 'move', desired: 2, minDuration: MIN, minGap: GAP });
  assert.strictEqual(r.feasible, false);
  assert.strictEqual(get(r.cues, 'c').start, 6.1);
  ok('压缩到极限后再多拖 => 无解');
}

// 4. 撞锁定片段且无法压缩 => 无解，冲突区间含锁定片段
{
  const cs = mk([{ id: 'a', s: 0, e: 3 }, { id: 'b', s: 3.1, e: 4.2 }, { id: 'c', s: 4.3, e: 8, l: true }]);
  // a 右缘目标 5.5：b 最多压到 [3.2,4.2](dur1)，边界 4.1；5.5>4.1 无解
  const r = applyDrag({ cues: cs, targetId: 'a', op: 'move', desired: 2.5, minDuration: MIN, minGap: GAP });
  assert.strictEqual(r.feasible, false);
  assert.ok(r.conflict);
  assert.strictEqual(get(r.cues, 'c').start, 4.3);
  ok('锁定阻挡且压缩不足 => 无解');
}

// 5. 向左移动推动前方片段（a 压缩到最小时长）
{
  const cs = mk([{ id: 'a', s: 0, e: 2 }, { id: 'b', s: 2.1, e: 4 }]);
  const r = applyDrag({ cues: cs, targetId: 'b', op: 'move', desired: 1.1, minDuration: MIN, minGap: GAP });
  assert.ok(r.feasible, r.conflict?.reason);
  assert.deepStrictEqual([get(r.cues, 'b').start, get(r.cues, 'b').end], [1.1, 3]);
  assert.deepStrictEqual([get(r.cues, 'a').start, get(r.cues, 'a').end], [0, 1]);
  ok('左移推动并压缩前方片段');
}

// 5b. 向左移动、间隔仍充足时不影响前方片段
{
  const cs = mk([{ id: 'a', s: 0, e: 2 }, { id: 'b', s: 3, e: 4 }]);
  const r = applyDrag({ cues: cs, targetId: 'b', op: 'move', desired: 2.4, minDuration: MIN, minGap: GAP });
  assert.ok(r.feasible, r.conflict?.reason);
  assert.deepStrictEqual([get(r.cues, 'a').start, get(r.cues, 'a').end], [0, 2]);
  assert.deepStrictEqual([get(r.cues, 'b').start, get(r.cues, 'b').end], [2.4, 3.4]);
  ok('左移间隔充足时不推动');
}

// 5c. 向左移动碰到前方片段后刚性平移
{
  const cs = mk([{ id: 'a', s: 0, e: 2 }, { id: 'b', s: 2.1, e: 4 }]);
  const r = applyDrag({ cues: cs, targetId: 'b', op: 'move', desired: 1.6, minDuration: MIN, minGap: GAP });
  assert.ok(r.feasible, r.conflict?.reason);
  // a 刚性平移到 [-0.5,1.5] 后撞墙，压缩吸收为 [0,1.5]（仍满足 gap）；b = [1.6,3.5]
  assert.deepStrictEqual([get(r.cues, 'a').start, get(r.cues, 'a').end], [0, 1.5]);
  assert.deepStrictEqual([get(r.cues, 'b').start, get(r.cues, 'b').end], [1.6, 3.5]);
  ok('左移刚性平移，越墙部分被吸收');
}

// 6. 向左越界 => 无解
{
  const cs = mk([{ id: 'a', s: 0, e: 2 }, { id: 'b', s: 2.1, e: 4 }]);
  const r = applyDrag({ cues: cs, targetId: 'b', op: 'move', desired: -1.5, minDuration: MIN, minGap: GAP });
  assert.strictEqual(r.feasible, false);
  assert.ok(r.conflict!.range[0] === 0);
  ok('向左超出 0s => 无解');
}

// 7. 左侧锁定片段阻挡，中间压缩可吸收 => 可行
{
  // L [0,2] locked; b [2.1,5]; c[5.1,7] 目标 c.start=3
  // b 刚性: end<=2.9 => [0,2.9]? 撞 L: end<=1.9 => 压缩 b start>=2.1(L.end+gap) dur>=1 => end>=3.1
  // c.start=3 <= 3.1+0.1=3.2? 需要 leftBound(3.2) <= 3 => 无解！改成 desired 3.2
  const cs = mk([{ id: 'L', s: 0, e: 2, l: true }, { id: 'b', s: 2.1, e: 5 }, { id: 'c', s: 5.1, e: 7 }]);
  const r = applyDrag({ cues: cs, targetId: 'c', op: 'move', desired: 3.2, minDuration: MIN, minGap: GAP });
  assert.ok(r.feasible, r.conflict?.reason);
  const b = get(r.cues, 'b');
  assert.strictEqual(b.start, 2.1);
  assert.strictEqual(Math.abs(b.end - 3.1) < 1e-6, true);
  assert.strictEqual(get(r.cues, 'L').end, 2);
  ok('左侧锁定 + 中间压缩可行');
}

// 8. resize-end 向右推动后续
{
  const cs = mk([{ id: 'a', s: 0, e: 2 }, { id: 'b', s: 2.1, e: 4 }]);
  const r = applyDrag({ cues: cs, targetId: 'a', op: 'resize-end', desired: 3.5, minDuration: MIN, minGap: GAP });
  assert.ok(r.feasible);
  assert.deepStrictEqual([get(r.cues, 'a').start, get(r.cues, 'a').end], [0, 3.5]);
  assert.deepStrictEqual([get(r.cues, 'b').start, get(r.cues, 'b').end], [3.6, 5.5]);
  ok('右边界拖动推动后续');
}

// 9. resize 短于最小时长 => 无解
{
  const cs = mk([{ id: 'a', s: 0, e: 2 }]);
  const r = applyDrag({ cues: cs, targetId: 'a', op: 'resize-end', desired: 0.5, minDuration: MIN, minGap: GAP });
  assert.strictEqual(r.feasible, false);
  ok('短于最小时长 => 无解');
}

// 10. 锁定目标不可拖（视为无变化可行）
{
  const cs = mk([{ id: 'a', s: 0, e: 2, l: true }]);
  const r = applyDrag({ cues: cs, targetId: 'a', op: 'move', desired: 5, minDuration: MIN, minGap: GAP });
  assert.ok(r.feasible);
  assert.strictEqual(get(r.cues, 'a').start, 0);
  ok('锁定片段自身不移动');
}

// 11. 连续三个片段链式推移，末端开放 => 全部平移，时长保持
{
  const cs = mk([{ id: 'a', s: 0, e: 2 }, { id: 'b', s: 2.1, e: 4 }, { id: 'c', s: 4.1, e: 6 }]);
  const r = applyDrag({ cues: cs, targetId: 'a', op: 'move', desired: 1, minDuration: MIN, minGap: GAP });
  assert.ok(r.feasible);
  assert.deepStrictEqual([get(r.cues, 'b').start, get(r.cues, 'b').end], [3.1, 5]);
  assert.deepStrictEqual([get(r.cues, 'c').start, get(r.cues, 'c').end], [5.1, 7]);
  ok('链式刚性推移');
}

// 12. 原始 baseline 不被修改（撤销语义依赖快照）
{
  const cs = mk([{ id: 'a', s: 0, e: 2 }, { id: 'b', s: 2.1, e: 4 }]);
  const snapshot = JSON.parse(JSON.stringify(cs));
  applyDrag({ cues: cs, targetId: 'a', op: 'move', desired: 9, minDuration: MIN, minGap: GAP });
  assert.deepStrictEqual(cs, snapshot);
  ok('输入数组不被原地修改');
}

// ---------- 画面布局 ----------
function mkc(id: string, s: number, e: number, settings: string, text = '一行字幕'): Cue {
  return { id, identifier: '', start: s, end: e, text, settings, locked: false };
}

// 1. 合法设置解析（align:middle 归一化为 center）
{
  const p = parseLayoutSettings('line:90% position:50% align:middle');
  assert.strictEqual(p.errors.length, 0);
  assert.strictEqual(p.layout.line?.percent, 90);
  assert.strictEqual(p.layout.position?.percent, 50);
  assert.strictEqual(p.layout.align, 'center');
  const p2 = parseLayoutSettings('line:-1 position:20%,line-left size:60% align:end');
  assert.strictEqual(p2.errors.length, 0);
  assert.strictEqual(p2.layout.line?.lineNumber, -1);
  assert.strictEqual(p2.layout.position?.align, 'line-left');
  assert.strictEqual(p2.layout.size, 60);
  assert.strictEqual(p2.layout.align, 'end');
  ok('布局设置解析：百分比/行号/对齐');
}

// 2. 非法值逐项报告，未知字段不参与也不报错
{
  const p = parseLayoutSettings('line:120% size:abc position:50%,middle align:top vertical:rl foo:bar');
  assert.strictEqual(p.errors.length, 4);
  assert.deepStrictEqual(p.errors.map((e) => e.key), ['line', 'size', 'position', 'align']);
  assert.strictEqual(p.layout.line, undefined); // 非法字段按未设置处理
  assert.strictEqual(hasLayoutSettings('vertical:rl foo:bar'), false);
  assert.strictEqual(hasLayoutSettings('vertical:rl line:90%'), true);
  ok('非法布局值检测，未知字段忽略');
}

// 3. updateCueSettings 保留未知设置的原始顺序与内容
{
  const s0 = 'vertical:rl line:10% foo:bar position:20%';
  assert.strictEqual(updateCueSettings(s0, 'line', '90%'), 'vertical:rl line:90% foo:bar position:20%');
  assert.strictEqual(updateCueSettings(s0, 'align', 'end'), 'vertical:rl line:10% foo:bar position:20% align:end');
  assert.strictEqual(updateCueSettings(s0, 'line', ''), 'vertical:rl foo:bar position:20%');
  assert.strictEqual(updateCueSettings('', 'size', '60%'), 'size:60%');
  assert.strictEqual(getLayoutRaw(s0, 'position'), '20%');
  assert.strictEqual(getLayoutRaw(s0, 'align'), '');
  ok('更新布局字段时保留未知设置顺序与内容');
}

// 4. 字幕框计算与安全区
{
  // line:90% position:50% align:middle，1 行：宽 100%，左 0，顶 90，高 5.33
  const a = mkc('a', 0, 2, 'line:90% position:50% align:middle');
  const boxA = computeCueBox(a, parseLayoutSettings(a.settings).layout);
  assert.ok(Math.abs(boxA.left - 0) < 1e-6 && Math.abs(boxA.top - 90) < 1e-6);
  assert.ok(Math.abs(boxA.width - 100) < 1e-6 && Math.abs(boxA.height - 5.33) < 1e-6);
  assert.deepStrictEqual(safeAreaViolations(boxA), ['左', '右', '下']);

  // 安全区内的框：line:50% position:50%,center size:60%
  const b = mkc('b', 0, 2, 'line:50% position:50%,center size:60%');
  const boxB = computeCueBox(b, parseLayoutSettings(b.settings).layout);
  assert.deepStrictEqual(safeAreaViolations(boxB), []);

  // align:right 推导 position 对齐为 line-right：右缘锚在 80%
  const c = mkc('c', 0, 2, 'position:80% align:right size:40%');
  const boxC = computeCueBox(c, parseLayoutSettings(c.settings).layout);
  assert.ok(Math.abs(boxC.left - 40) < 1e-6);
  ok('字幕框计算与 10% 安全区检测');
}

// 5. 布局问题进入问题清单，点击可定位（cueIds 指向对应片段）
{
  const cues = [
    mkc('k1', 0, 2, 'line:90% position:50% align:middle'),
    mkc('k2', 3, 5, 'size:120%'),
    mkc('k3', 6, 8, ''), // 无设置：不产生布局问题
  ];
  const iss = detectIssues(cues, { minDuration: 1, minGap: 0.1 });
  const safe = iss.find((i) => i.kind === 'safearea');
  const layout = iss.find((i) => i.kind === 'layout');
  assert.ok(safe && safe.severity === 'warning' && safe.cueIds[0] === 'k1');
  assert.ok(layout && layout.severity === 'error' && layout.cueIds[0] === 'k2');
  assert.ok(!iss.some((i) => i.cueIds.includes('k3')));
  ok('问题清单包含安全区警告与非法布局错误');
}

// 6. 修改布局字段后导出，未知设置与时序行为不受影响
{
  const src = `WEBVTT

1
00:00.000 --> 00:02.500 vertical:rl line:10% foo:bar align:start
第一行
`;
  const parsed = parseVTT(src);
  assert.ok(!parsed.error, parsed.error);
  const cue = parsed.cues[0];
  cue.settings = updateCueSettings(cue.settings, 'align', 'end');
  cue.settings = updateCueSettings(cue.settings, 'size', '60%');
  const out = serializeVTT(parsed.cues, parsed.preamble);
  assert.ok(out.includes('vertical:rl line:10% foo:bar align:end size:60%'));
  assert.ok(out.includes('00:00.000 --> 00:02.500'));
  ok('布局编辑后导出保留未知设置与时序');
}

console.log(`\n全部 ${passed} 组测试通过 ✅`);
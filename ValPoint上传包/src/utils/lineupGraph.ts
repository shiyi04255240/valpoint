/**
 * lineupGraph - 站位/落点关系图
 *
 * 职责：
 * - 把坐标重合（或极近）的站位、落点合并成地图上的同一个点。
 * - 把每条点位视为一条连线，建立站位与落点之间的多对多关系。
 * - 为地图高亮、新增时复用已有站位/落点提供查询。
 */

import type { LineupPosition } from '../types/lineup';

export type PointKind = 'stand' | 'land';

export type GraphLineup = {
  id: string;
  agentName?: string | null;
  abilityIndex?: number | null;
  agentPos?: LineupPosition | null;
  skillPos?: LineupPosition | null;
  agentIcon?: string | null;
  skillIcon?: string | null;
  createdAt?: string | null;
};

export type PointGroup = {
  key: string;
  kind: PointKind;
  pos: LineupPosition;
  icon: string | null;
  agentName: string;
  /** 落点按技能区分；站位不区分技能，为 null */
  abilityIndex: number | null;
  /** 经过这个点的点位（按创建时间从早到晚） */
  lineupIds: string[];
  /** 与之相连的另一类点（站位 → 落点，落点 → 站位） */
  linkedKeys: string[];
};

export type LineupGraph = {
  groups: Record<string, PointGroup>;
  stands: PointGroup[];
  lands: PointGroup[];
  standKeyOf: Record<string, string>;
  landKeyOf: Record<string, string>;
};

/**
 * 地图坐标范围为 0~1000。两个点相距不超过该值时视为同一个站位/落点，
 * 约为地图宽度的 1.2%，默认缩放下两个图标几乎完全重叠。
 * 新增时点选已有的点会直接沿用其坐标，不依赖这个容差。
 */
export const POINT_MERGE_DISTANCE = 12;

const distance = (a: LineupPosition, b: LineupPosition) => Math.hypot(a.lat - b.lat, a.lng - b.lng);

const byCreatedAsc = (a: GraphLineup, b: GraphLineup) => (a.createdAt || '').localeCompare(b.createdAt || '');

export function buildLineupGraph(lineups: GraphLineup[]): LineupGraph {
  const groups: Record<string, PointGroup> = {};
  const stands: PointGroup[] = [];
  const lands: PointGroup[] = [];
  const standKeyOf: Record<string, string> = {};
  const landKeyOf: Record<string, string> = {};

  // 按创建时间从早到晚归组，新增点位不会改变已有点的位置
  const ordered = [...lineups].sort(byCreatedAsc);

  const place = (
    list: PointGroup[],
    kind: PointKind,
    agentName: string,
    abilityIndex: number | null,
    pos: LineupPosition,
    icon: string | null | undefined,
    lineupId: string,
  ) => {
    let target: PointGroup | null = null;
    let nearest = Infinity;
    for (const group of list) {
      if (group.agentName !== agentName || group.abilityIndex !== abilityIndex) continue;
      const d = distance(group.pos, pos);
      if (d <= POINT_MERGE_DISTANCE && d < nearest) {
        nearest = d;
        target = group;
      }
    }

    if (!target) {
      const key = `${kind}|${agentName}|${abilityIndex ?? ''}|${pos.lat.toFixed(2)},${pos.lng.toFixed(2)}`;
      target = { key, kind, pos, icon: icon || null, agentName, abilityIndex, lineupIds: [], linkedKeys: [] };
      list.push(target);
      groups[key] = target;
    }

    if (!target.icon && icon) target.icon = icon;
    target.lineupIds.push(lineupId);
    return target.key;
  };

  ordered.forEach((l) => {
    if (!l.agentPos || !l.skillPos) return;
    const agentName = l.agentName || '';
    const standKey = place(stands, 'stand', agentName, null, l.agentPos, l.agentIcon, l.id);
    const landKey = place(lands, 'land', agentName, l.abilityIndex ?? null, l.skillPos, l.skillIcon, l.id);
    standKeyOf[l.id] = standKey;
    landKeyOf[l.id] = landKey;
    if (!groups[standKey].linkedKeys.includes(landKey)) groups[standKey].linkedKeys.push(landKey);
    if (!groups[landKey].linkedKeys.includes(standKey)) groups[landKey].linkedKeys.push(standKey);
  });

  return { groups, stands, lands, standKeyOf, landKeyOf };
}

/** 同时经过两个点（一个站位 + 一个落点）的点位 */
export function getLineupIdsBetween(graph: LineupGraph, keyA: string, keyB: string): string[] {
  const a = graph.groups[keyA];
  const b = graph.groups[keyB];
  if (!a || !b) return [];
  const inB = new Set(b.lineupIds);
  return a.lineupIds.filter((id) => inB.has(id));
}

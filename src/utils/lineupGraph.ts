/**
 * lineupGraph - 站位/落点关系图
 *
 * 职责：
 * - 个人库：按独立存储的站位 / 落点与它们之间的连线建图，并为每个站位分配连线颜色。
 * - 共享库：把坐标重合（或极近）的站位、落点合并成地图上的同一个点。
 * - 为地图高亮、筛选提供查询。
 */

import type { LineupPoint, LineupPosition } from '../types/lineup';

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
  title?: string;
  label?: string | null;
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

export type GraphLink = GraphLineup & {
  standId?: string | null;
  landId?: string | null;
};

/**
 * 个人库：站位 / 落点是独立存在的点，连线记录了它连着哪两个点。
 * 没有连线的点同样显示；两端有一端不在 points 里的连线忽略。
 */
export function buildPointGraph(points: LineupPoint[], links: GraphLink[]): LineupGraph {
  const groups: Record<string, PointGroup> = {};
  const stands: PointGroup[] = [];
  const lands: PointGroup[] = [];
  const standKeyOf: Record<string, string> = {};
  const landKeyOf: Record<string, string> = {};

  points.forEach((p) => {
    const group: PointGroup = {
      key: p.id,
      kind: p.kind,
      pos: p.pos,
      icon: (p.kind === 'stand' ? p.agentIcon : p.skillIcon) || null,
      agentName: p.agentName,
      abilityIndex: p.kind === 'land' ? p.abilityIndex : null,
      lineupIds: [],
      linkedKeys: [],
      title: p.title,
      label: p.label ?? null,
    };
    groups[p.id] = group;
    (p.kind === 'stand' ? stands : lands).push(group);
  });

  [...links].sort(byCreatedAsc).forEach((l) => {
    const stand = l.standId ? groups[l.standId] : undefined;
    const land = l.landId ? groups[l.landId] : undefined;
    if (!stand || !land || stand.kind !== 'stand' || land.kind !== 'land') return;
    stand.lineupIds.push(l.id);
    land.lineupIds.push(l.id);
    standKeyOf[l.id] = stand.key;
    landKeyOf[l.id] = land.key;
    if (!stand.linkedKeys.includes(land.key)) stand.linkedKeys.push(land.key);
    if (!land.linkedKeys.includes(stand.key)) land.linkedKeys.push(stand.key);
  });

  return { groups, stands, lands, standKeyOf, landKeyOf };
}

type PointScope = {
  mapKeys: string[];
  agentName: string | null;
  side: 'all' | 'attack' | 'defense';
  abilityIndex: number | null;
};

const inScope = (p: LineupPoint, scope: PointScope) =>
  scope.mapKeys.includes(p.mapName) &&
  (!scope.agentName || p.agentName === scope.agentName) &&
  (scope.side === 'all' || p.side === scope.side) &&
  (p.kind === 'stand' || scope.abilityIndex === null || p.abilityIndex === scope.abilityIndex);

/**
 * 查看时显示的点：符合地图 / 角色 / 攻防 / 技能筛选，并且
 * 要么还没有任何连线，要么至少有一条连线出现在当前筛选结果里（例如按标题搜索时）。
 */
export function selectPointsForView(points: LineupPoint[], allLinks: GraphLink[], visibleLinks: GraphLink[], scope: PointScope) {
  const linked = new Set<string>();
  allLinks.forEach((l) => {
    if (l.standId) linked.add(l.standId);
    if (l.landId) linked.add(l.landId);
  });
  const visible = new Set<string>();
  visibleLinks.forEach((l) => {
    if (l.standId) visible.add(l.standId);
    if (l.landId) visible.add(l.landId);
  });
  return points.filter((p) => inScope(p, scope) && (!linked.has(p.id) || visible.has(p.id)));
}

/** 新增时显示的点：符合地图 / 角色 / 攻防 / 技能筛选的全部点 */
export function selectPointsForCreate(points: LineupPoint[], scope: PointScope) {
  return points.filter((p) => inScope(p, scope));
}

/** 站位连线的配色（在灰色地图和深色背景上都容易区分） */
export const STAND_COLORS = ['#38bdf8', '#fb923c', '#f472b6', '#4ade80', '#a78bfa', '#facc15', '#2dd4bf', '#f87171', '#a3e635', '#60a5fa'];

/**
 * 每个站位一种颜色：同一地图、同一角色的站位按创建先后依次取色。
 * 基于全部站位计算，筛选、搜索时颜色不会变。
 */
export function assignStandColors(points: LineupPoint[]): Record<string, string> {
  const counters: Record<string, number> = {};
  const colors: Record<string, string> = {};
  [...points]
    .filter((p) => p.kind === 'stand')
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id))
    .forEach((p) => {
      const scope = `${p.mapName}|${p.agentName}`;
      const index = counters[scope] || 0;
      counters[scope] = index + 1;
      colors[p.id] = STAND_COLORS[index % STAND_COLORS.length];
    });
  return colors;
}

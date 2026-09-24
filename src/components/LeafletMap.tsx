/**
 * LeafletMap - Leaflet地图
 *
 * 职责：
 * - 渲染Leaflet地图相关的界面结构与样式。
 * - 处理用户交互与状态变更并触发回调。
 * - 组合子组件并提供可配置项。
 *
 * 站位与落点是多对多关系，每条点位是它们之间的一条连线：
 * - 个人库传入 points（独立的站位 / 落点），地图直接按它们显示；
 * - 共享库不传 points，坐标重合的站位 / 落点合并成一个图标。
 * 点击站位（或落点）会聚焦它：相关的落点（或站位）高亮，其余变暗且不可点击；点地图空白处恢复。
 */

// @ts-nocheck
import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as L from 'leaflet';
import { getAbilityIcon } from '../utils/abilityIcons';
import { buildLineupGraph, buildPointGraph, getLineupIdsBetween, POINT_MERGE_DISTANCE } from '../utils/lineupGraph';
import { clearAutoFilledFields, fillFormFromPoint, POINT_FORM_FIELDS } from '../features/lineups/lineupHelpers';
import { BaseLineup, AgentOption, NewLineupForm, SharedLineup, LineupPoint } from '../types/lineup';
import { ActiveTab } from '../types/app';
import { useEmailAuth } from '../hooks/useEmailAuth';
import { useErrorMarks } from '../hooks/useErrorMarks';

type Lineup = {
  id: string;
  title?: string;
  standId?: string | null;
  landId?: string | null;
  agentName?: string;
  abilityIndex?: number | null;
  agentPos?: { lat: number; lng: number } | null;
  skillPos?: { lat: number; lng: number } | null;
  agentIcon?: string | null;
  skillIcon?: string | null;
  createdAt?: string | null;
};

type PointKind = 'stand' | 'land';

type Props = {
  mapIcon: string | null;
  mapCover?: string | null;
  disableFitBoundsAnimation?: boolean;
  activeTab: string;
  lineups: Lineup[];
  selectedLineupId: string | null;
  onLineupSelect: (id: string | null) => void;
  newLineupData: any;
  setNewLineupData: (fn: (prev: any) => any) => void;
  placingType: string | null;
  setPlacingType: (val: string | null) => void;
  selectedAgent: any;
  selectedAbilityIndex: number | null;
  onViewLineup?: (id: string) => void;
  isFlipped: boolean;
  sharedLineup?: any;
  showErrorMarking?: boolean;
  /** 新增/编辑时可直接点选复用的已有点位（同地图、同特工、同攻防） */
  snapLineups?: Lineup[];
  /** 从聚焦的站位/落点出发新增点位；不传则不显示入口 */
  onCreateFromPoint?: (kind: PointKind, pos: { lat: number; lng: number }, lineupIds: string[]) => void;
  /** 个人库：独立存在的站位 / 落点；传入后地图按它们显示，lineups 为它们之间的连线 */
  points?: LineupPoint[];
  /** 受控的聚焦点（与 onFocusPoint 一起传入时，聚焦状态由外部管理，地图底部不再显示提示条） */
  focusedPointId?: string | null;
  onFocusPoint?: (id: string | null) => void;
  /** 新增页的工具与交互（仅个人库） */
  pointTool?: 'stand' | 'land' | 'link' | null;
  linkSourceId?: string | null;
  onMapPlace?: (pos: { lat: number; lng: number }) => void;
  onPointClick?: (id: string) => void;
  onPointMove?: (id: string, pos: { lat: number; lng: number }) => void;
  /** 地图底部被详情面板遮住的高度（像素）；聚焦的点落在这里时自动把地图往上移 */
  focusBottomInset?: number;
  /** 个人库：每个站位的连线颜色（落点跟随它连着的站位） */
  standColors?: Record<string, string>;
};

const MARKER_STATE_CLASSES = ['marker-focus', 'marker-active', 'marker-inactive'];

const LINK_TRACK = { color: '#ff4655', weight: 1, opacity: 0.35, interactive: false };
const NEUTRAL_LINK_COLOR = '#ece8e1';

// 个人库的连线：常驻显示的彩色虚线；聚焦时换成沿线流动的圆点
const linkLine = (color: string, emphasis = false) => ({
  color,
  weight: emphasis ? 3.5 : 2,
  opacity: emphasis ? 1 : 0.85,
  dashArray: '6 6',
  interactive: false,
});
const linkTrack = (color: string) => ({ color, weight: 1.5, opacity: 0.45, interactive: false });
const linkFlow = (color: string, weight = 3) => ({ ...LINK_FLOW, color, weight });
const LINK_FLOW = { color: '#ff4655', weight: 3, opacity: 0.95, dashArray: '1 8', lineCap: 'round', className: 'vp-link-flow', interactive: false };
const HOVER_LINE = { color: 'white', weight: 1.5, opacity: 0.7, dashArray: '4 6', interactive: false };
const DRAFT_LINE = { color: '#ff4655', weight: 3, dashArray: '8, 8', interactive: false };

const KIND_LABEL: Record<PointKind, string> = { stand: '站位', land: '落点' };
const OTHER_KIND: Record<PointKind, PointKind> = { stand: 'land', land: 'stand' };

const escapeAttr = (value: string) =>
  String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 站位 → 落点画成向一侧弯曲的弧线，像技能的投掷轨迹；多个落点时呈扇形散开
const arcPoints = (from, to) => {
  const dx = to.lng - from.lng;
  const dy = to.lat - from.lat;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [from, to];
  const bend = Math.min(len * 0.18, 60);
  const cx = (from.lng + to.lng) / 2 - (dy / len) * bend;
  const cy = (from.lat + to.lat) / 2 + (dx / len) * bend;
  const points = [];
  const steps = 24;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    points.push([u * u * from.lat + 2 * u * t * cy + t * t * to.lat, u * u * from.lng + 2 * u * t * cx + t * t * to.lng]);
  }
  return points;
};

const LeafletMap: React.FC<Props> = ({
  mapIcon,
  mapCover,
  disableFitBoundsAnimation = false,
  activeTab,
  lineups,
  selectedLineupId,
  onLineupSelect,
  newLineupData,
  setNewLineupData,
  placingType,
  setPlacingType,
  selectedAgent,
  selectedAbilityIndex,
  onViewLineup,
  isFlipped,
  sharedLineup,
  showErrorMarking = false,
  snapLineups,
  onCreateFromPoint,
  points,
  focusedPointId,
  onFocusPoint,
  pointTool = null,
  linkSourceId = null,
  onMapPlace,
  onPointClick,
  onPointMove,
  focusBottomInset = 0,
  standColors,
}) => {
  const pointMode = Array.isArray(points);
  const controlled = typeof onFocusPoint === 'function';
  const { user } = useEmailAuth();
  const { errorMarks } = useErrorMarks(showErrorMarking ? user?.id : undefined);

  const fitBoundsOptions = useMemo(
    () => (disableFitBoundsAnimation ? { animate: false } : undefined),
    [disableFitBoundsAnimation]
  );
  const mapRef = useRef(null);
  const mapInstance = useRef<any>(null);
  const groupMarkers = useRef<Record<string, any>>({});
  const linkLayer = useRef<any>(null);
  const layers = useRef<{ createLayer: any[]; sharedLayer: any[] }>({ createLayer: [], sharedLayer: [] });
  const hasAppliedFlip = useRef(false);
  const openedLineupId = useRef<string | null>(null);
  const groupClickRef = useRef<(key: string) => void>(() => { });
  const groupHoverRef = useRef<(key: string) => void>(() => { });
  // 新增时点选已有点自动带入的配图/说明，记录下来以便点被移走或换点时撤掉
  const autoFilled = useRef<Record<PointKind, { pos: { lat: number; lng: number }; fields: Record<string, unknown> } | null>>({ stand: null, land: null });

  const [innerFocusKey, setInnerFocusKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const focusKey = controlled ? focusedPointId ?? null : innerFocusKey;
  const setFocusKey = (key: string | null) => {
    if (controlled) onFocusPoint(key);
    else setInnerFocusKey(key);
  };

  const graph = useMemo(() => (pointMode ? buildPointGraph(points, lineups) : buildLineupGraph(lineups)), [pointMode, points, lineups]);
  const lineupById = useMemo(() => Object.fromEntries(lineups.map((l) => [l.id, l])), [lineups]);
  const snapGraph = useMemo(() => buildLineupGraph(snapLineups || []), [snapLineups]);
  const snapLineupById = useMemo(() => Object.fromEntries((snapLineups || []).map((l) => [l.id, l])), [snapLineups]);

  const isViewLike = activeTab !== 'create';
  const focusGroup = isViewLike && focusKey ? graph.groups[focusKey] || null : null;
  const linkSourceGroup = activeTab === 'create' && pointMode && linkSourceId ? graph.groups[linkSourceId] || null : null;
  const snapKind: PointKind | null = placingType === 'agent' ? 'stand' : placingType === 'skill' ? 'land' : null;
  const snapLands = useMemo(
    () => snapGraph.lands.filter((g) => selectedAbilityIndex === null || g.abilityIndex === selectedAbilityIndex),
    [snapGraph, selectedAbilityIndex]
  );
  const snapTargetCount = snapKind === 'stand' ? snapGraph.stands.length : snapKind === 'land' ? snapLands.length : 0;

  const colorOfStand = (key: string) => standColors?.[key] || NEUTRAL_LINK_COLOR;
  const ringOf = (group) =>
    !pointMode ? null : group.kind === 'stand' ? colorOfStand(group.key) : group.linkedKeys[0] ? colorOfStand(group.linkedKeys[0]) : null;
  // 个人库用直线（与客户参考的战术板一致），共享库保留弧线
  const linkPath = (from, to) => (pointMode ? [from, to] : arcPoints(from, to));

  const transformPos = (pos: any) => {
    if (!pos) return null;
    if (isFlipped) {
      return { lat: 1000 - pos.lat, lng: 1000 - pos.lng };
    }
    return pos;
  };

  const inverseTransformPos = (pos: any) => {
    if (!pos) return null;
    if (isFlipped) {
      return { lat: 1000 - pos.lat, lng: 1000 - pos.lng };
    }
    return pos;
  };

  // 手动把点放到别处（不再是之前复用的那个点）时，撤掉自动带入且未改动过的内容
  const releaseAutoFill = (kind: PointKind, pos: { lat: number; lng: number }) => {
    const record = autoFilled.current[kind];
    if (!record) return;
    if (Math.hypot(pos.lat - record.pos.lat, pos.lng - record.pos.lng) <= POINT_MERGE_DISTANCE) return;
    autoFilled.current[kind] = null;
    setNewLineupData((prev: any) => clearAutoFilledFields(prev, record.fields));
  };

  // 切换页签、地图时退出聚焦；聚焦的点被筛掉时同样退出
  useEffect(() => {
    if (focusKey) setFocusKey(null);
  }, [activeTab, mapIcon]);

  useEffect(() => {
    if (focusKey && activeTab !== 'create' && !graph.groups[focusKey]) setFocusKey(null);
  }, [graph, focusKey, activeTab]);

  useEffect(() => {
    autoFilled.current = { stand: null, land: null };
  }, [activeTab]);

  useEffect(() => {
    setHoveredKey(null);
  }, [graph, focusKey, selectedLineupId]);

  // 从列表等外部入口选中点位时，以外部选中为准并退出聚焦（受控时由外部决定）
  useEffect(() => {
    if (!selectedLineupId) {
      openedLineupId.current = null;
      return;
    }
    if (!controlled && selectedLineupId !== openedLineupId.current) setInnerFocusKey(null);
  }, [selectedLineupId]);

  useEffect(() => {
    if (mapInstance.current) mapInstance.current.closePopup();
  }, [focusKey, graph, activeTab]);

  useEffect(() => {
    const map = mapInstance.current;
    const group = focusKey ? graph.groups[focusKey] : null;
    if (!map || !group || !focusBottomInset) return;
    const point = map.latLngToContainerPoint(transformPos(group.pos));
    const limit = map.getSize().y - focusBottomInset - 56;
    if (point.y > limit) map.panBy([0, point.y - limit], { animate: true });
  }, [focusKey, focusBottomInset]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }
    mapRef.current.innerHTML = '';
    const map = L.map(mapRef.current, {
      crs: L.CRS.Simple,
      minZoom: -2,
      maxZoom: 2,
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.1,
      scrollWheelZoom: false,
      wheelPxPerZoomLevel: 120,
    });
    mapInstance.current = map;
    linkLayer.current = L.layerGroup().addTo(map);
    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
      linkLayer.current = null;
    };
  }, []);

  // 说明：为 iPad/触控模拟环境提供稳定的滚轮缩放兜底能力。
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const container: HTMLElement = map.getContainer();
    const handleWheelZoom = (event: WheelEvent) => {
      event.preventDefault();

      const zoomDelta = event.deltaY < 0 ? 0.2 : -0.2;
      const currentZoom = map.getZoom();
      const nextZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), currentZoom + zoomDelta));
      if (nextZoom === currentZoom) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const point = L.point(event.clientX - rect.left, event.clientY - rect.top);
      map.setZoomAround(point, nextZoom, { animate: false });
    };

    container.addEventListener('wheel', handleWheelZoom, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheelZoom);
    };
  }, []);

  // 说明：监听容器尺寸变化，解决生产环境 CSS 延迟加载导致地图不居中的问题
  useEffect(() => {
    const map = mapInstance.current;
    const container = mapRef.current;
    if (!map || !container) return;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
      const bounds: L.LatLngBoundsExpression = [[0, 0], [1000, 1000]];
      map.fitBounds(bounds, { animate: false });
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    const clickHandler = (e: any) => {
      L.DomEvent.preventDefault(e);
      L.DomEvent.stop(e);
      if (activeTab === 'create' && pointMode) {
        if (onMapPlace) onMapPlace(inverseTransformPos({ lat: e.latlng.lat, lng: e.latlng.lng }));
      } else if (activeTab === 'create' && placingType) {
        const rawPos = { lat: e.latlng.lat, lng: e.latlng.lng };
        const standardPos = inverseTransformPos(rawPos);
        if (placingType === 'agent') setNewLineupData((prev: any) => ({ ...prev, agentPos: standardPos }));
        else setNewLineupData((prev: any) => ({ ...prev, skillPos: standardPos }));
        releaseAutoFill(placingType === 'agent' ? 'stand' : 'land', standardPos);
      } else if (activeTab === 'view') {
        setFocusKey(null);
        onLineupSelect(null);
      }
    };
    map.off('click');
    map.on('click', clickHandler);
    return () => map.off('click', clickHandler);
  }, [activeTab, placingType, setNewLineupData, onLineupSelect, isFlipped, pointMode, onMapPlace, controlled, onFocusPoint]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !mapIcon) return;
    map.eachLayer((l: any) => {
      if (l instanceof L.ImageOverlay) map.removeLayer(l);
    });
    const bounds: any = [
      [0, 0],
      [1000, 1000],
    ];
    L.imageOverlay(mapIcon, bounds).addTo(map);
    map.fitBounds(bounds, fitBoundsOptions);
  }, [mapIcon, fitBoundsOptions]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    if (!hasAppliedFlip.current) {
      hasAppliedFlip.current = true;
      return;
    }
    const timer = setTimeout(() => {
      map.invalidateSize();
      const bounds: any = [[0, 0], [1000, 1000]];
      map.fitBounds(bounds, fitBoundsOptions);
    }, 100);
    return () => clearTimeout(timer);
  }, [isFlipped, fitBoundsOptions]);

  const createIcon = (
    type: 'agent' | 'skill',
    imgUrl?: string | null,
    { hasError = false, badge = 0, className = '', label = null, ring = null }: { hasError?: boolean; badge?: number; className?: string; label?: string | null; ring?: string | null } = {}
  ) => {
    const errorOverlay = hasError ? `<div class="absolute inset-0 bg-red-500/50 rounded-full z-10 pointer-events-none"></div>` : '';
    const styles = [ring ? `--vp-ring: ${escapeAttr(ring)}` : '', hasError ? 'border-color: #ef4444 !important' : ''].filter(Boolean);
    const errorStyle = styles.length ? `style="${styles.join('; ')}"` : '';
    const content = imgUrl
      ? `<div class="marker-icon-wrapper relative" ${errorStyle}>${errorOverlay}<img src="${escapeAttr(imgUrl)}" class="marker-img ${type === 'skill' ? 'marker-img-skill' : ''
      }"/></div>`
      : `<div class="marker-icon-wrapper bg-[#ff4655] text-white font-bold text-xs flex items-center justify-center relative" ${errorStyle}>${errorOverlay}${type === 'agent' ? 'A' : 'S'
      }</div>`;
    const badgeHtml = badge > 1 ? `<span class="marker-link-badge">${badge}</span>` : '';
    const labelHtml = label ? `<span class="marker-label-badge">${escapeAttr(label)}</span>` : '';
    return L.divIcon({
      className: `custom-marker ${hasError ? 'marker-error' : ''} ${className}`.trim(),
      html: content + badgeHtml + labelHtml,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  };

  const setMarkerState = (marker: any, state: 'focus' | 'active' | 'inactive' | 'normal') => {
    const el = marker.getElement();
    if (!el) return;
    el.classList.remove(...MARKER_STATE_CLASSES);
    if (state === 'focus') el.classList.add('marker-focus', 'marker-active');
    else if (state === 'active') el.classList.add('marker-active');
    else if (state === 'inactive') el.classList.add('marker-inactive');
    marker.setZIndexOffset(state === 'focus' ? 1000 : state === 'active' ? 800 : state === 'inactive' ? 0 : 500);
  };

  const openLineup = (id: string) => {
    openedLineupId.current = id;
    onLineupSelect(id);
    if (onViewLineup) onViewLineup(id);
  };

  // 同一对站位与落点之间有多条点位时，弹出小列表让用户挑一条
  const openLineupChooser = (group, ids: string[]) => {
    const map = mapInstance.current;
    if (!map) return;
    const box = document.createElement('div');
    box.className = 'vp-chooser';
    const head = document.createElement('div');
    head.className = 'vp-chooser-head';
    head.textContent = `这里有 ${ids.length} 条点位，选一条查看`;
    box.appendChild(head);
    [...ids].reverse().forEach((id) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'vp-chooser-item';
      item.textContent = lineupById[id]?.title || '未命名点位';
      item.addEventListener('click', () => {
        map.closePopup();
        openLineup(id);
      });
      box.appendChild(item);
    });
    L.popup({ closeButton: false, className: 'vp-chooser-popup', offset: [0, -16], minWidth: 180, maxWidth: 260 })
      .setLatLng(transformPos(group.pos))
      .setContent(box)
      .openOn(map);
  };

  // 屏幕上叠在一起（相距不到半个图标）的点：点击时让用户选是哪一个，而不是只能点到最上面那个
  const OVERLAP_PX = 16;
  const overlappingGroups = (group) => {
    const map = mapInstance.current;
    if (!map) return [group];
    const origin = map.latLngToContainerPoint(transformPos(group.pos));
    return Object.values(graph.groups).filter((g) => {
      const pt = map.latLngToContainerPoint(transformPos(g.pos));
      return Math.hypot(pt.x - origin.x, pt.y - origin.y) <= OVERLAP_PX;
    });
  };

  const openPointChooser = (group, candidates, onPick: (key: string) => void) => {
    const map = mapInstance.current;
    if (!map) return;
    const box = document.createElement('div');
    box.className = 'vp-chooser';
    const head = document.createElement('div');
    head.className = 'vp-chooser-head';
    head.textContent = `这里叠着 ${candidates.length} 个点，选一个`;
    box.appendChild(head);
    candidates.forEach((g) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'vp-chooser-item';
      const dot = document.createElement('span');
      dot.className = 'vp-chooser-dot';
      const color = ringOf(g);
      if (color) dot.style.backgroundColor = color;
      item.appendChild(dot);
      const text = document.createElement('span');
      const links = g.linkedKeys.length;
      text.textContent = `${KIND_LABEL[g.kind]} · ${g.title || '未命名'}${links ? `（${links} 条连线）` : ''}`;
      item.appendChild(text);
      item.addEventListener('click', () => {
        map.closePopup();
        onPick(g.key);
      });
      box.appendChild(item);
    });
    L.popup({ closeButton: false, className: 'vp-chooser-popup', offset: [0, -16], minWidth: 200, maxWidth: 280 })
      .setLatLng(transformPos(group.pos))
      .setContent(box)
      .openOn(map);
  };

  // 聚焦或选中时不做悬停预览，避免连线反复重绘
  groupHoverRef.current = (key: string) => {
    if (focusKey || (selectedLineupId && graph.standKeyOf[selectedLineupId])) return;
    setHoveredKey(key);
  };

  groupClickRef.current = (key: string) => {
    const group = graph.groups[key];
    if (!group) return;
    const current = focusKey ? graph.groups[focusKey] : null;

    if (!current) {
      const focusOn = (k: string) => {
        if (selectedLineupId) onLineupSelect(null);
        setFocusKey(k);
      };
      const stacked = overlappingGroups(group);
      if (stacked.length > 1) openPointChooser(group, stacked, focusOn);
      else focusOn(key);
      return;
    }

    if (current.linkedKeys.includes(key)) {
      const ids = getLineupIdsBetween(graph, current.key, key);
      if (ids.length === 1) openLineup(ids[0]);
      else if (ids.length > 1) openLineupChooser(group, ids);
      return;
    }

    // 再次点击聚焦中的点：恢复原状
    setFocusKey(null);
    if (selectedLineupId) onLineupSelect(null);
  };

  // 查看模式：每个站位/落点一个图标
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    Object.values(groupMarkers.current).forEach((m) => map.removeLayer(m));
    groupMarkers.current = {};
    layers.current.sharedLayer.forEach((l) => map.removeLayer(l));
    layers.current.sharedLayer = [];

    if (activeTab === 'shared' && sharedLineup) {
      const l = sharedLineup;
      const viewAgentPos = transformPos(l.agentPos);
      const viewSkillPos = transformPos(l.skillPos);
      if (viewAgentPos && viewSkillPos) {
        const hasError = !!errorMarks[l.id];
        const am = L.marker(viewAgentPos, { icon: createIcon('agent', l.agentIcon, { hasError }) }).addTo(map);
        const sm = L.marker(viewSkillPos, { icon: createIcon('skill', l.skillIcon, { hasError }) }).addTo(map);
        const line = L.polyline(arcPoints(viewAgentPos, viewSkillPos), DRAFT_LINE).addTo(map);
        layers.current.sharedLayer = [am, sm, line];
      }
      return;
    }

    if (activeTab === 'create') return;

    [...graph.stands, ...graph.lands].forEach((group) => {
      const hasError = group.lineupIds.some((id) => !!errorMarks[id]);
      const marker = L.marker(transformPos(group.pos), {
        icon: createIcon(group.kind === 'stand' ? 'agent' : 'skill', group.icon, { hasError, badge: group.linkedKeys.length, label: group.label, ring: ringOf(group) }),
        keyboard: false,
        title: group.title || '',
        riseOnHover: true,
      }).addTo(map);
      marker.on('click', (e: any) => {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stop(e);
        groupClickRef.current(group.key);
      });
      marker.on('mouseover', () => groupHoverRef.current(group.key));
      marker.on('mouseout', () => setHoveredKey((k) => (k === group.key ? null : k)));
      groupMarkers.current[group.key] = marker;
    });
  }, [graph, activeTab, isFlipped, errorMarks, sharedLineup, standColors]);

  // 查看模式：聚焦 / 选中 / 悬停时的高亮与连线
  useEffect(() => {
    const map = mapInstance.current;
    const layer = linkLayer.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (activeTab === 'create') return;

    const currentFocus = focusKey ? graph.groups[focusKey] : null;
    const selectedPair = selectedLineupId && graph.standKeyOf[selectedLineupId]
      ? [graph.standKeyOf[selectedLineupId], graph.landKeyOf[selectedLineupId]]
      : null;

    let activeKeys = new Set<string>();
    let links: string[][] = [];
    let dimOthers = false;
    if (currentFocus) {
      activeKeys = new Set(currentFocus.linkedKeys);
      links = currentFocus.linkedKeys.map((k) => (currentFocus.kind === 'stand' ? [currentFocus.key, k] : [k, currentFocus.key]));
      dimOthers = true;
    } else if (selectedPair) {
      activeKeys = new Set(selectedPair);
      links = [selectedPair];
      dimOthers = true;
    }

    Object.entries(groupMarkers.current).forEach(([key, marker]) => {
      if (currentFocus && key === currentFocus.key) setMarkerState(marker, 'focus');
      else if (activeKeys.has(key)) setMarkerState(marker, 'active');
      else setMarkerState(marker, dimOthers ? 'inactive' : 'normal');
    });

    const pathBetween = (standKey: string, landKey: string) =>
      linkPath(transformPos(graph.groups[standKey].pos), transformPos(graph.groups[landKey].pos));

    // 没有聚焦时所有连线常驻显示，同一个站位出发的线同一种颜色；悬停的点的连线加粗
    if (!dimOthers && pointMode) {
      graph.stands.forEach((stand) => {
        const color = colorOfStand(stand.key);
        stand.linkedKeys.forEach((landKey) => {
          const emphasis = hoveredKey === stand.key || hoveredKey === landKey;
          L.polyline(pathBetween(stand.key, landKey), linkLine(color, emphasis)).addTo(layer);
        });
      });
    }

    links.forEach(([standKey, landKey]) => {
      const points = pathBetween(standKey, landKey);
      const isCurrent = selectedPair && selectedPair[0] === standKey && selectedPair[1] === landKey;
      if (pointMode) {
        const color = colorOfStand(standKey);
        L.polyline(points, linkTrack(color)).addTo(layer);
        L.polyline(points, linkFlow(color, isCurrent && currentFocus ? 4.5 : 3)).addTo(layer);
        return;
      }
      L.polyline(points, LINK_TRACK).addTo(layer);
      L.polyline(points, isCurrent && currentFocus ? { ...LINK_FLOW, weight: 4.5 } : LINK_FLOW).addTo(layer);
    });

    const hovered = !dimOthers && !pointMode && hoveredKey ? graph.groups[hoveredKey] : null;
    if (hovered) {
      hovered.linkedKeys.forEach((k) => {
        const [standKey, landKey] = hovered.kind === 'stand' ? [hovered.key, k] : [k, hovered.key];
        L.polyline(pathBetween(standKey, landKey), HOVER_LINE).addTo(layer);
      });
    }
  }, [graph, activeTab, isFlipped, errorMarks, sharedLineup, focusKey, selectedLineupId, hoveredKey, pointMode, standColors]);

  // 新增/编辑模式：正在标注的站位与落点，以及可复用的已有点
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    layers.current.createLayer.forEach((l) => map.removeLayer(l));
    layers.current.createLayer = [];
    if (activeTab !== 'create') return;

    if (pointMode) {
      const source = linkSourceId ? graph.groups[linkSourceId] : null;
      const pathBetween = (standKey: string, landKey: string) =>
        linkPath(transformPos(graph.groups[standKey].pos), transformPos(graph.groups[landKey].pos));
      graph.stands.forEach((stand) => {
        const color = colorOfStand(stand.key);
        stand.linkedKeys.forEach((landKey) => {
          const fromSource = source && (source.key === stand.key || source.key === landKey);
          const line = L.polyline(pathBetween(stand.key, landKey), fromSource ? linkFlow(color) : linkLine(color)).addTo(map);
          layers.current.createLayer.push(line);
        });
      });
      [...graph.stands, ...graph.lands].forEach((group) => {
        const isSource = source && source.key === group.key;
        const linkedToSource = source && source.linkedKeys.includes(group.key);
        const className = isSource ? 'marker-link-source' : linkedToSource ? 'marker-active' : '';
        const marker = L.marker(transformPos(group.pos), {
          icon: createIcon(group.kind === 'stand' ? 'agent' : 'skill', group.icon, { badge: group.linkedKeys.length, label: group.label, className, ring: ringOf(group) }),
          keyboard: false,
          draggable: true,
          riseOnHover: true,
          title: group.title || '',
          zIndexOffset: isSource ? 1000 : linkedToSource ? 800 : 500,
        }).addTo(map);
        marker.on('click', (e: any) => {
          L.DomEvent.preventDefault(e);
          L.DomEvent.stop(e);
          if (!onPointClick) return;
          const stacked = overlappingGroups(group);
          if (stacked.length > 1) openPointChooser(group, stacked, onPointClick);
          else onPointClick(group.key);
        });
        marker.on('dragend', (e: any) => {
          const latlng = e.target.getLatLng();
          if (onPointMove) onPointMove(group.key, inverseTransformPos({ lat: latlng.lat, lng: latlng.lng }));
        });
        layers.current.createLayer.push(marker);
      });
      return;
    }

    const addGhost = (group) => {
      const snappable = group.kind === snapKind;
      const marker = L.marker(transformPos(group.pos), {
        icon: createIcon(group.kind === 'stand' ? 'agent' : 'skill', group.icon, {
          className: snappable ? 'marker-ghost marker-ghost-snappable' : 'marker-ghost',
        }),
        keyboard: false,
        interactive: snappable,
        zIndexOffset: snappable ? 200 : -200,
      }).addTo(map);
      if (snappable) {
        marker.on('click', (e: any) => {
          L.DomEvent.preventDefault(e);
          L.DomEvent.stop(e);
          const kind = group.kind;
          const sources = group.lineupIds.map((id) => snapLineupById[id]).filter(Boolean);
          const posField = kind === 'stand' ? 'agentPos' : 'skillPos';
          // 换成另一个已有点时，先撤掉上一个点带入的内容，再带入这个点的
          const previous = autoFilled.current[kind];
          let base = { ...newLineupData, [posField]: { ...group.pos } };
          if (previous) base = clearAutoFilledFields(base, previous.fields);
          const next = fillFormFromPoint(base, kind, sources);
          const fields = {};
          POINT_FORM_FIELDS[kind].forEach((field) => {
            if (next[field] !== base[field]) fields[field] = next[field];
          });
          autoFilled.current[kind] = Object.keys(fields).length ? { pos: group.pos, fields } : null;
          setNewLineupData(() => next);
        });
      }
      layers.current.createLayer.push(marker);
    };
    snapGraph.stands.forEach(addGhost);
    snapLands.forEach(addGhost);

    const { agentPos, skillPos } = newLineupData;
    const currentAgentIcon = selectedAgent?.displayIcon || null;
    const currentSkillIcon = getAbilityIcon(selectedAgent, selectedAbilityIndex);

    const viewAgentPos = transformPos(agentPos);
    const viewSkillPos = transformPos(skillPos);

    const onDragEnd = (type: 'agent' | 'skill') => (e: any) => {
      const rawPos = { lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng };
      const standardPos = inverseTransformPos(rawPos);
      if (type === 'agent') setNewLineupData((prev: any) => ({ ...prev, agentPos: standardPos }));
      else setNewLineupData((prev: any) => ({ ...prev, skillPos: standardPos }));
      releaseAutoFill(type === 'agent' ? 'stand' : 'land', standardPos);
    };

    if (viewAgentPos) {
      const m = L.marker(viewAgentPos, { icon: createIcon('agent', currentAgentIcon), draggable: true, keyboard: false, zIndexOffset: 1000 }).addTo(map);
      m.on('dragend', onDragEnd('agent'));
      layers.current.createLayer.push(m);
    }
    if (viewSkillPos) {
      const m = L.marker(viewSkillPos, { icon: createIcon('skill', currentSkillIcon), draggable: true, keyboard: false, zIndexOffset: 1000 }).addTo(map);
      m.on('dragend', onDragEnd('skill'));
      layers.current.createLayer.push(m);
    }
    if (viewAgentPos && viewSkillPos) {
      const l = L.polyline(arcPoints(viewAgentPos, viewSkillPos), DRAFT_LINE).addTo(map);
      layers.current.createLayer.push(l);
    }
  }, [activeTab, newLineupData, selectedAgent, selectedAbilityIndex, isFlipped, snapGraph, snapLands, snapKind, snapLineupById, setNewLineupData, pointMode, graph, linkSourceId, onPointClick, onPointMove, standColors]);

  const focusOtherLabel = focusGroup ? KIND_LABEL[OTHER_KIND[focusGroup.kind]] : '';

  return (
    <div className="w-full h-full relative">
      {mapCover && (
        <div
          className="absolute inset-0 pointer-events-none opacity-10"
          style={{ backgroundImage: `url(${mapCover})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        />
      )}
      <div ref={mapRef} className="w-full h-full z-0 outline-none relative" />

      {focusGroup && !controlled && (
        <div className="absolute inset-x-0 bottom-[92px] md:bottom-6 z-10 flex justify-center px-3 pointer-events-none">
          <div
            key={focusGroup.key}
            role="status"
            className="vp-focus-hint pointer-events-auto flex items-center gap-3 h-12 pl-1.5 pr-1.5 rounded-xl bg-black/75 backdrop-blur-md border border-white/15 shadow-2xl max-w-full"
          >
            <span className="w-9 h-9 shrink-0 rounded-full border-2 border-[#ff4655] bg-[#1f2326] overflow-hidden flex items-center justify-center">
              {focusGroup.icon ? (
                <img
                  src={focusGroup.icon}
                  alt=""
                  className={focusGroup.kind === 'land' ? 'w-[70%] h-[70%] object-contain' : 'w-full h-full object-cover'}
                />
              ) : (
                <span className="text-xs font-bold text-white">{focusGroup.kind === 'stand' ? 'A' : 'S'}</span>
              )}
            </span>
            <div className="min-w-0 overflow-hidden leading-tight whitespace-nowrap pr-1">
              <div className="text-[13px] font-bold text-white truncate">
                {KIND_LABEL[focusGroup.kind]}
                <span className="font-normal text-gray-400"> · 关联 </span>
                <span className="text-[#ff4655] tabular-nums">{focusGroup.linkedKeys.length}</span>
                <span className="font-normal text-gray-400"> 个{focusOtherLabel}</span>
              </div>
              <div className="text-[11px] text-gray-500 truncate">点亮起的{focusOtherLabel}看详情 · 点空白处恢复</div>
            </div>
            {onCreateFromPoint && (
              <button
                type="button"
                onClick={() => onCreateFromPoint(focusGroup.kind, focusGroup.pos, focusGroup.lineupIds)}
                className="h-9 px-3 shrink-0 rounded-lg bg-[#ff4655] hover:bg-[#ff5b6b] text-white text-[13px] font-bold whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                + 添加{focusOtherLabel}
              </button>
            )}
          </div>
        </div>
      )}

      {activeTab === 'create' && pointMode && pointTool && (
        <div className="absolute inset-x-0 bottom-6 z-10 flex justify-center px-3 pointer-events-none">
          <div
            key={`${pointTool}-${linkSourceId || ''}`}
            role="status"
            className="vp-focus-hint flex items-center gap-2 h-10 px-4 rounded-xl bg-black/75 backdrop-blur-md border border-white/15 shadow-2xl text-[13px] text-gray-200 max-w-full"
          >
            <span className={`vp-dot-pulse w-2 h-2 shrink-0 rounded-full ${linkSourceGroup ? 'bg-[#f0c75e]' : 'bg-[#ff4655]'}`} />
            <span className="truncate">
              {pointTool === 'link'
                ? linkSourceGroup
                  ? `起点「${linkSourceGroup.title || KIND_LABEL[linkSourceGroup.kind]}」已选好：点${KIND_LABEL[OTHER_KIND[linkSourceGroup.kind]]}连上，可以连多个；点空白处换起点`
                  : '先点一个站位（或落点）作为起点，再点要连的落点（或站位）'
                : `点地图就放一个${KIND_LABEL[pointTool]}，可以连续放；点已有的点补图文，按住拖动可移动`}
            </span>
          </div>
        </div>
      )}

      {activeTab === 'create' && !pointMode && snapKind && snapTargetCount > 0 && (
        <div className="absolute inset-x-0 bottom-6 z-10 flex justify-center px-3 pointer-events-none">
          <div
            key={snapKind}
            role="status"
            className="vp-focus-hint flex items-center gap-2 h-10 px-4 rounded-xl bg-black/75 backdrop-blur-md border border-white/15 shadow-2xl text-[13px] text-gray-200 max-w-full"
          >
            <span className="vp-dot-pulse w-2 h-2 shrink-0 rounded-full bg-[#ff4655]" />
            <span className="truncate">
              点一下亮起的已有{KIND_LABEL[snapKind]}即可复用，配图会自动带入
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(LeafletMap);

/**
 * LeafletMap - Leaflet地图
 *
 * 职责：
 * - 渲染Leaflet地图相关的界面结构与样式。
 * - 处理用户交互与状态变更并触发回调。
 * - 组合子组件并提供可配置项。
 *
 * 站位与落点是多对多关系：坐标重合的站位/落点合并成一个图标，每条点位是它们之间的一条连线。
 * 点击站位（或落点）会聚焦它：相关的落点（或站位）高亮，其余变暗且不可点击；点地图空白处恢复。
 */

// @ts-nocheck
import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as L from 'leaflet';
import { getAbilityIcon } from '../utils/abilityIcons';
import { buildLineupGraph, getLineupIdsBetween, POINT_MERGE_DISTANCE } from '../utils/lineupGraph';
import { clearAutoFilledFields, fillFormFromPoint, POINT_FORM_FIELDS } from '../features/lineups/lineupHelpers';
import { BaseLineup, AgentOption, NewLineupForm, SharedLineup } from '../types/lineup';
import { ActiveTab } from '../types/app';
import { useEmailAuth } from '../hooks/useEmailAuth';
import { useErrorMarks } from '../hooks/useErrorMarks';

type Lineup = {
  id: string;
  title?: string;
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
};

const MARKER_STATE_CLASSES = ['marker-focus', 'marker-active', 'marker-inactive'];

const LINK_TRACK = { color: '#ff4655', weight: 1, opacity: 0.35, interactive: false };
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
}) => {
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

  const [focus, setFocus] = useState<{ kind: PointKind; key: string } | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const graph = useMemo(() => buildLineupGraph(lineups), [lineups]);
  const lineupById = useMemo(() => Object.fromEntries(lineups.map((l) => [l.id, l])), [lineups]);
  const snapGraph = useMemo(() => buildLineupGraph(snapLineups || []), [snapLineups]);
  const snapLineupById = useMemo(() => Object.fromEntries((snapLineups || []).map((l) => [l.id, l])), [snapLineups]);

  const isViewLike = activeTab !== 'create';
  const focusGroup = isViewLike && focus ? graph.groups[focus.key] || null : null;
  const snapKind: PointKind | null = placingType === 'agent' ? 'stand' : placingType === 'skill' ? 'land' : null;
  const snapLands = useMemo(
    () => snapGraph.lands.filter((g) => selectedAbilityIndex === null || g.abilityIndex === selectedAbilityIndex),
    [snapGraph, selectedAbilityIndex]
  );
  const snapTargetCount = snapKind === 'stand' ? snapGraph.stands.length : snapKind === 'land' ? snapLands.length : 0;

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
    setFocus(null);
  }, [activeTab, mapIcon]);

  useEffect(() => {
    if (focus && !graph.groups[focus.key]) setFocus(null);
  }, [graph, focus]);

  useEffect(() => {
    autoFilled.current = { stand: null, land: null };
  }, [activeTab]);

  useEffect(() => {
    setHoveredKey(null);
  }, [graph, focus, selectedLineupId]);

  // 从列表等外部入口选中点位时，以外部选中为准并退出聚焦
  useEffect(() => {
    if (!selectedLineupId) {
      openedLineupId.current = null;
      return;
    }
    if (selectedLineupId !== openedLineupId.current) setFocus(null);
  }, [selectedLineupId]);

  useEffect(() => {
    if (mapInstance.current) mapInstance.current.closePopup();
  }, [focus, graph, activeTab]);

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
      if (activeTab === 'create' && placingType) {
        const rawPos = { lat: e.latlng.lat, lng: e.latlng.lng };
        const standardPos = inverseTransformPos(rawPos);
        if (placingType === 'agent') setNewLineupData((prev: any) => ({ ...prev, agentPos: standardPos }));
        else setNewLineupData((prev: any) => ({ ...prev, skillPos: standardPos }));
        releaseAutoFill(placingType === 'agent' ? 'stand' : 'land', standardPos);
      } else if (activeTab === 'view') {
        setFocus(null);
        onLineupSelect(null);
      }
    };
    map.off('click');
    map.on('click', clickHandler);
    return () => map.off('click', clickHandler);
  }, [activeTab, placingType, setNewLineupData, onLineupSelect, isFlipped]);

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
    { hasError = false, badge = 0, className = '' }: { hasError?: boolean; badge?: number; className?: string } = {}
  ) => {
    const errorOverlay = hasError ? `<div class="absolute inset-0 bg-red-500/50 rounded-full z-10 pointer-events-none"></div>` : '';
    const errorStyle = hasError ? `style="border-color: #ef4444 !important;"` : '';
    const content = imgUrl
      ? `<div class="marker-icon-wrapper relative" ${errorStyle}>${errorOverlay}<img src="${escapeAttr(imgUrl)}" class="marker-img ${type === 'skill' ? 'marker-img-skill' : ''
      }"/></div>`
      : `<div class="marker-icon-wrapper bg-[#ff4655] text-white font-bold text-xs flex items-center justify-center relative" ${errorStyle}>${errorOverlay}${type === 'agent' ? 'A' : 'S'
      }</div>`;
    const badgeHtml = badge > 1 ? `<span class="marker-link-badge">${badge}</span>` : '';
    return L.divIcon({
      className: `custom-marker ${hasError ? 'marker-error' : ''} ${className}`.trim(),
      html: content + badgeHtml,
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

  // 聚焦或选中时不做悬停预览，避免连线反复重绘
  groupHoverRef.current = (key: string) => {
    if (focus || (selectedLineupId && graph.standKeyOf[selectedLineupId])) return;
    setHoveredKey(key);
  };

  groupClickRef.current = (key: string) => {
    const group = graph.groups[key];
    if (!group) return;
    const current = focus ? graph.groups[focus.key] : null;

    if (!current) {
      if (selectedLineupId) onLineupSelect(null);
      setFocus({ kind: group.kind, key });
      return;
    }

    if (current.linkedKeys.includes(key)) {
      const ids = getLineupIdsBetween(graph, current.key, key);
      if (ids.length === 1) openLineup(ids[0]);
      else if (ids.length > 1) openLineupChooser(group, ids);
      return;
    }

    // 再次点击聚焦中的点：恢复原状
    setFocus(null);
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
        icon: createIcon(group.kind === 'stand' ? 'agent' : 'skill', group.icon, { hasError, badge: group.linkedKeys.length }),
        keyboard: false,
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
  }, [graph, activeTab, isFlipped, errorMarks, sharedLineup]);

  // 查看模式：聚焦 / 选中 / 悬停时的高亮与连线
  useEffect(() => {
    const map = mapInstance.current;
    const layer = linkLayer.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (activeTab === 'create') return;

    const currentFocus = focus ? graph.groups[focus.key] : null;
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

    const arcBetween = (standKey: string, landKey: string) =>
      arcPoints(transformPos(graph.groups[standKey].pos), transformPos(graph.groups[landKey].pos));

    links.forEach(([standKey, landKey]) => {
      const points = arcBetween(standKey, landKey);
      const isCurrent = selectedPair && selectedPair[0] === standKey && selectedPair[1] === landKey;
      L.polyline(points, LINK_TRACK).addTo(layer);
      L.polyline(points, isCurrent && currentFocus ? { ...LINK_FLOW, weight: 4.5 } : LINK_FLOW).addTo(layer);
    });

    const hovered = !dimOthers && hoveredKey ? graph.groups[hoveredKey] : null;
    if (hovered) {
      hovered.linkedKeys.forEach((k) => {
        const [standKey, landKey] = hovered.kind === 'stand' ? [hovered.key, k] : [k, hovered.key];
        L.polyline(arcBetween(standKey, landKey), HOVER_LINE).addTo(layer);
      });
    }
  }, [graph, activeTab, isFlipped, errorMarks, sharedLineup, focus, selectedLineupId, hoveredKey]);

  // 新增/编辑模式：正在标注的站位与落点，以及可复用的已有点
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    layers.current.createLayer.forEach((l) => map.removeLayer(l));
    layers.current.createLayer = [];
    if (activeTab !== 'create') return;

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
  }, [activeTab, newLineupData, selectedAgent, selectedAbilityIndex, isFlipped, snapGraph, snapLands, snapKind, snapLineupById, setNewLineupData]);

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

      {focusGroup && (
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

      {activeTab === 'create' && snapKind && snapTargetCount > 0 && (
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

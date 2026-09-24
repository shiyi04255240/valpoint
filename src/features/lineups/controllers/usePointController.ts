/**
 * usePointController - 站位 / 落点控制器
 *
 * 职责：
 * - 管理个人库里站位、落点的放置、移动、编辑、删除，以及它们之间的连线。
 * - 管理地图上聚焦的站位 / 落点（详情面板显示的对象）。
 * - 管理新增页的工具（放站位 / 放落点 / 连线）和对应的编辑弹窗、确认弹窗状态。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPointApi, createLinkApi, deletePointApi, updatePointApi } from '../../../services/points';
import { deleteLineupApi, updateLineupApi } from '../../../services/lineups';
import { getAbilityIcon } from '../../../utils/abilityIcons';
import { createEmptyLineup } from '../lineupHelpers';
import type { ActiveTab } from '../../../types/app';
import type {
  AgentOption,
  BaseLineup,
  LineupPoint,
  LineupPosition,
  LineupSide,
  MapOption,
  NewLineupForm,
  PointDbPayload,
  PointForm,
  PointKind,
} from '../../../types/lineup';

export type PointTool = 'stand' | 'land' | 'link';
export type PointEditorMode = 'stand' | 'land' | 'link';

export type PointEditorState = {
  mode: PointEditorMode;
  /** 编辑已有站位 / 落点时为它的 id，编辑连线时为点位 id，新建时为 null */
  editingId: string | null;
};

export type PointConfirmState = {
  title: string;
  message: string;
  actionLabel: string;
  onConfirm: () => void;
  /** 删除类操作为 danger（默认） */
  variant?: 'danger' | 'default';
};

export type LinkedItem = { lineup: BaseLineup; other: LineupPoint };

type Params = {
  isGuest: boolean;
  userId: string | null;
  userCustomId: string | null;
  activeTab: ActiveTab;
  selectedMap: MapOption | null;
  selectedAgent: AgentOption | null;
  selectedSide: 'all' | LineupSide;
  selectedAbilityIndex: number | null;
  agents: AgentOption[];
  points: LineupPoint[];
  lineups: BaseLineup[];
  mapNameZhToEn: Record<string, string>;
  fetchLineups: (userId: string | null) => Promise<void>;
  setAlertMessage: (msg: string | null) => void;
  handleTabSwitch: (tab: ActiveTab) => void;
  setSelectedSide: (side: 'all' | LineupSide) => void;
  setSelectedAgent: (agent: AgentOption | null) => void;
};

export const KIND_NAME: Record<PointKind, string> = { stand: '站位', land: '落点' };
const OTHER_KIND: Record<PointKind, PointKind> = { stand: 'land', land: 'stand' };

export const pointDisplayName = (p: Pick<LineupPoint, 'kind' | 'title'>) => p.title?.trim() || `未命名${KIND_NAME[p.kind]}`;

const emptyPointForm = (kind: PointKind): PointForm => ({
  kind,
  pos: null,
  title: '',
  abilityIndex: null,
  label: null,
  standImg: '',
  standDesc: '',
  stand2Img: '',
  stand2Desc: '',
  landImg: '',
  landDesc: '',
  enableStand2: false,
});

const pointToForm = (p: LineupPoint): PointForm => ({
  kind: p.kind,
  pos: p.pos,
  title: p.title || '',
  abilityIndex: p.abilityIndex,
  label: p.label ?? null,
  standImg: p.standImg || '',
  standDesc: p.standDesc || '',
  stand2Img: p.stand2Img || '',
  stand2Desc: p.stand2Desc || '',
  landImg: p.landImg || '',
  landDesc: p.landDesc || '',
  enableStand2: !!(p.stand2Img || p.stand2Desc),
});

const lineupToForm = (l: BaseLineup): NewLineupForm => ({
  ...createEmptyLineup(),
  title: l.title || '',
  agentPos: l.agentPos,
  skillPos: l.skillPos,
  standImg: l.standImg || '',
  standDesc: l.standDesc || '',
  stand2Img: l.stand2Img || '',
  stand2Desc: l.stand2Desc || '',
  aimImg: l.aimImg || '',
  aimDesc: l.aimDesc || '',
  aim2Img: l.aim2Img || '',
  aim2Desc: l.aim2Desc || '',
  landImg: l.landImg || '',
  landDesc: l.landDesc || '',
  sourceLink: l.sourceLink || '',
  authorName: l.authorName || '',
  authorAvatar: l.authorAvatar || '',
  authorUid: l.authorUid || '',
  enableStand2: !!(l.stand2Img || l.stand2Desc),
  enableAim2: !!(l.aim2Img || l.aim2Desc),
  isJump: !!l.isJump,
});

const nextDefaultTitle = (points: LineupPoint[], kind: PointKind, mapName: string, agentName: string) => {
  const count = points.filter((p) => p.kind === kind && p.mapName === mapName && p.agentName === agentName).length;
  return `${KIND_NAME[kind]} ${count + 1}`;
};

export function usePointController({
  isGuest,
  userId,
  userCustomId,
  activeTab,
  selectedMap,
  selectedAgent,
  selectedSide,
  selectedAbilityIndex,
  agents,
  points,
  lineups,
  mapNameZhToEn,
  fetchLineups,
  setAlertMessage,
  handleTabSwitch,
  setSelectedSide,
  setSelectedAgent,
}: Params) {
  const [tool, setToolState] = useState<PointTool | null>(null);
  const [linkSourceId, setLinkSourceId] = useState<string | null>(null);
  const [focusedPointId, setFocusedPointId] = useState<string | null>(null);
  const [editor, setEditor] = useState<PointEditorState | null>(null);
  const [pointForm, setPointForm] = useState<PointForm>(emptyPointForm('stand'));
  const [linkForm, setLinkForm] = useState<NewLineupForm>(createEmptyLineup());
  const [confirm, setConfirm] = useState<PointConfirmState | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const pointById = useMemo(() => Object.fromEntries(points.map((p) => [p.id, p])), [points]);

  // 离开新增页时收起工具；离开查看页时关闭详情
  useEffect(() => {
    if (activeTab !== 'create') {
      setToolState(null);
      setLinkSourceId(null);
    }
    if (activeTab !== 'view') setFocusedPointId(null);
  }, [activeTab]);

  // 聚焦 / 连线起点被删除后自动清掉
  useEffect(() => {
    if (focusedPointId && !pointById[focusedPointId]) setFocusedPointId(null);
    if (linkSourceId && !pointById[linkSourceId]) setLinkSourceId(null);
  }, [pointById, focusedPointId, linkSourceId]);

  const refresh = useCallback(() => fetchLineups(userId), [fetchLineups, userId]);

  const guard = useCallback(() => {
    if (isGuest || !userId) {
      setAlertMessage('请先登录再编辑站位和落点');
      return false;
    }
    return true;
  }, [isGuest, userId, setAlertMessage]);

  const setTool = useCallback((next: PointTool | null) => {
    setToolState((prev) => (prev === next ? null : next));
    setLinkSourceId(null);
  }, []);

  const linkedItemsOf = useCallback(
    (point: LineupPoint): LinkedItem[] =>
      lineups
        .filter((l) => (point.kind === 'stand' ? l.standId === point.id : l.landId === point.id))
        .map((l) => ({ lineup: l, other: pointById[(point.kind === 'stand' ? l.landId : l.standId) || ''] }))
        .filter((item): item is LinkedItem => !!item.other),
    [lineups, pointById],
  );

  const focusedPoint = focusedPointId ? pointById[focusedPointId] || null : null;
  const focusedItems = useMemo(() => (focusedPoint ? linkedItemsOf(focusedPoint) : []), [focusedPoint, linkedItemsOf]);
  const linkSource = linkSourceId ? pointById[linkSourceId] || null : null;

  // ---------- 放置 ----------

  /** 点一下地图就放一个站位 / 落点（名称自动生成），图文之后点这个点再补 */
  const createPointAt = useCallback(
    async (kind: PointKind, pos: LineupPosition) => {
      if (!guard() || !userId) return;
      if (!selectedMap || !selectedAgent) {
        setAlertMessage('请先选择地图和角色');
        return;
      }
      if (kind === 'land' && selectedAbilityIndex === null) {
        setAlertMessage('放落点前，请先在左侧“选择使用技能”里选一个技能');
        return;
      }
      try {
        await createPointApi(
          {
            user_id: userId,
            kind,
            map_name: selectedMap.displayName,
            agent_name: selectedAgent.displayName,
            agent_icon: selectedAgent.displayIcon || null,
            side: selectedSide === 'all' ? 'attack' : selectedSide,
            ability_index: kind === 'land' ? selectedAbilityIndex : null,
            skill_icon: kind === 'land' ? getAbilityIcon(selectedAgent, selectedAbilityIndex) : null,
            pos,
            title: nextDefaultTitle(points, kind, selectedMap.displayName, selectedAgent.displayName),
          },
          mapNameZhToEn,
        );
        await refresh();
      } catch (e) {
        console.error(e);
        setAlertMessage(`放置${KIND_NAME[kind]}失败，请重试`);
      }
    },
    [guard, userId, selectedMap, selectedAgent, selectedSide, selectedAbilityIndex, points, mapNameZhToEn, refresh, setAlertMessage],
  );

  // ---------- 编辑弹窗 ----------

  const editPoint = useCallback(
    (point: LineupPoint) => {
      if (!guard()) return;
      setPointForm(pointToForm(point));
      setEditor({ mode: point.kind, editingId: point.id });
    },
    [guard],
  );

  const editLink = useCallback(
    (lineup: BaseLineup) => {
      if (!guard()) return;
      setLinkForm(lineupToForm(lineup));
      setEditor({ mode: 'link', editingId: lineup.id });
    },
    [guard],
  );

  const closeEditor = useCallback(() => setEditor(null), []);

  const savePoint = async (mode: PointKind, editingId: string | null) => {
    const existing = editingId ? pointById[editingId] : null;
    if (!existing) return false;
    const form = pointForm;
    if (mode === 'land' && form.abilityIndex === null) {
      setAlertMessage('请选择这个落点对应的技能');
      return false;
    }
    const agent = agents.find((a) => a.displayName === existing.agentName) || selectedAgent;
    const fields: Partial<PointDbPayload> =
      mode === 'stand'
        ? {
          title: form.title.trim(),
          stand_img: form.standImg,
          stand_desc: form.standDesc,
          stand2_img: form.enableStand2 ? form.stand2Img : '',
          stand2_desc: form.enableStand2 ? form.stand2Desc : '',
        }
        : {
          title: form.title.trim(),
          ability_index: form.abilityIndex,
          skill_icon: agent ? getAbilityIcon(agent, form.abilityIndex) : null,
          label: form.label,
          land_img: form.landImg,
          land_desc: form.landDesc,
        };

    await updatePointApi(existing.id, fields, mapNameZhToEn);
    return true;
  };

  /** 编辑连线：连线自己的内容写回点位；站位 / 落点的图文有改动时写回站位 / 落点，所有经过它的连线一起更新 */
  const saveLink = async (lineupId: string) => {
    const lineup = lineups.find((l) => l.id === lineupId);
    if (!lineup) return false;
    const form = linkForm;
    if (!form.title.trim()) {
      setAlertMessage('标题不能为空');
      return false;
    }
    const sourceLink = form.sourceLink.trim();
    await updateLineupApi(lineupId, {
      title: form.title.trim(),
      aim_img: form.aimImg,
      aim_desc: form.aimDesc,
      aim2_img: form.enableAim2 ? form.aim2Img : '',
      aim2_desc: form.enableAim2 ? form.aim2Desc : '',
      source_link: sourceLink,
      author_name: sourceLink ? form.authorName || null : null,
      author_avatar: sourceLink ? form.authorAvatar || null : null,
      author_uid: sourceLink ? form.authorUid || null : null,
      is_jump: !!form.isJump,
      updated_at: new Date().toISOString(),
    });

    const stand = lineup.standId ? pointById[lineup.standId] : null;
    const standFields = {
      stand_img: form.standImg,
      stand_desc: form.standDesc,
      stand2_img: form.enableStand2 ? form.stand2Img : '',
      stand2_desc: form.enableStand2 ? form.stand2Desc : '',
    };
    if (
      stand &&
      (standFields.stand_img !== (stand.standImg || '') ||
        standFields.stand_desc !== (stand.standDesc || '') ||
        standFields.stand2_img !== (stand.stand2Img || '') ||
        standFields.stand2_desc !== (stand.stand2Desc || ''))
    ) {
      await updatePointApi(stand.id, standFields, mapNameZhToEn);
    }

    const land = lineup.landId ? pointById[lineup.landId] : null;
    if (land && (form.landImg !== (land.landImg || '') || form.landDesc !== (land.landDesc || ''))) {
      await updatePointApi(land.id, { land_img: form.landImg, land_desc: form.landDesc }, mapNameZhToEn);
    }
    return true;
  };

  const saveEditor = useCallback(async () => {
    if (!editor || isSaving || !guard()) return;
    setIsSaving(true);
    try {
      const ok = editor.mode === 'link' ? await saveLink(editor.editingId || '') : await savePoint(editor.mode, editor.editingId);
      if (!ok) return;
      setEditor(null);
      await refresh();
    } catch (e) {
      console.error(e);
      setAlertMessage('保存失败，请重试');
    } finally {
      setIsSaving(false);
    }
  }, [editor, isSaving, guard, pointForm, linkForm, lineups, pointById, agents, selectedAgent, selectedMap, selectedSide, userId, refresh]);

  // ---------- 连线 ----------

  const connect = useCallback(
    async (a: LineupPoint, b: LineupPoint) => {
      if (!guard() || !userId) return;
      const stand = a.kind === 'stand' ? a : b;
      const land = a.kind === 'land' ? a : b;
      const existing = lineups.filter((l) => l.standId === stand.id && l.landId === land.id).length;
      const baseTitle = `${pointDisplayName(stand)} → ${pointDisplayName(land)}`;
      const create = async () => {
        try {
          await createLinkApi(stand, land, {
            userId,
            title: existing ? `${baseTitle} · ${existing + 1}` : baseTitle,
            creatorId: userCustomId,
          });
          await refresh();
        } catch (e) {
          console.error(e);
          setAlertMessage('连线失败，请重试');
        }
      };
      // 同一对站位和落点之间可以有多条连线（例如一条原地投、一条跳投），再加一条前先确认，避免误点
      if (existing) {
        setConfirm({
          title: '再加一条连线',
          message: `「${pointDisplayName(stand)}」和「${pointDisplayName(land)}」之间已经有 ${existing} 条连线。要再加一条新的打法吗？（例如一条原地投、一条跳投）`,
          actionLabel: '再加一条',
          variant: 'default',
          onConfirm: () => {
            setConfirm(null);
            create();
          },
        });
        return;
      }
      await create();
    },
    [guard, userId, userCustomId, lineups, refresh, setAlertMessage],
  );

  // ---------- 地图交互（新增页） ----------

  /** 点地图空白处：放站位 / 放落点工具下新建；连线工具下取消起点 */
  const handleMapPlace = useCallback(
    (pos: LineupPosition) => {
      if (tool === 'stand' || tool === 'land') createPointAt(tool, pos);
      else if (tool === 'link') setLinkSourceId(null);
    },
    [tool, createPointAt],
  );

  /** 点已有的站位 / 落点：连线工具下选起点或连上；其他情况打开编辑 */
  const handleCreatePointClick = useCallback(
    (pointId: string) => {
      const point = pointById[pointId];
      if (!point) return;
      if (tool !== 'link') {
        editPoint(point);
        return;
      }
      const source = linkSourceId ? pointById[linkSourceId] : null;
      if (!source || source.kind === point.kind) {
        setLinkSourceId(point.id === linkSourceId ? null : point.id);
        return;
      }
      connect(source, point);
    },
    [pointById, tool, linkSourceId, editPoint, connect],
  );

  const handlePointMove = useCallback(
    async (pointId: string, pos: LineupPosition) => {
      if (!guard()) return;
      try {
        await updatePointApi(pointId, { pos }, mapNameZhToEn);
        await refresh();
      } catch (e) {
        console.error(e);
        setAlertMessage('移动失败，请重试');
        await refresh();
      }
    },
    [guard, mapNameZhToEn, refresh, setAlertMessage],
  );

  /** 从详情面板出发去连线：切到新增页并选好起点 */
  const startLinkFrom = useCallback(
    (point: LineupPoint) => {
      if (!guard()) return;
      handleTabSwitch('create');
      if (selectedAgent?.displayName !== point.agentName) {
        const agent = agents.find((a) => a.displayName === point.agentName);
        if (agent) setSelectedAgent(agent);
      }
      setSelectedSide(point.side);
      setToolState('link');
      setLinkSourceId(point.id);
    },
    [guard, handleTabSwitch, selectedAgent, agents, setSelectedAgent, setSelectedSide],
  );

  // ---------- 删除 ----------

  const requestDeletePoint = useCallback(
    (point: LineupPoint) => {
      if (!guard()) return;
      const count = lineups.filter((l) => (point.kind === 'stand' ? l.standId : l.landId) === point.id).length;
      setConfirm({
        title: `删除${KIND_NAME[point.kind]}`,
        message: count
          ? `删除「${pointDisplayName(point)}」会同时删除它的 ${count} 条连线，删除后不可恢复。`
          : `确定删除「${pointDisplayName(point)}」吗？删除后不可恢复。`,
        actionLabel: '确认删除',
        onConfirm: async () => {
          setConfirm(null);
          try {
            await deletePointApi(point.id);
            setEditor(null);
            await refresh();
          } catch (e) {
            console.error(e);
            setAlertMessage('删除失败，请重试');
          }
        },
      });
    },
    [guard, lineups, refresh, setAlertMessage],
  );

  const requestDeleteLink = useCallback(
    (lineup: BaseLineup) => {
      if (!guard()) return;
      setConfirm({
        title: '断开连线',
        message: `断开「${lineup.title}」后，这条连线的瞄点图也会一起删除；站位和落点本身会保留。`,
        actionLabel: '确认断开',
        onConfirm: async () => {
          setConfirm(null);
          try {
            await deleteLineupApi(lineup.id);
            await refresh();
          } catch (e) {
            console.error(e);
            setAlertMessage('断开失败，请重试');
          }
        },
      });
    },
    [guard, refresh, setAlertMessage],
  );

  const otherKindOf = (kind: PointKind) => OTHER_KIND[kind];

  return {
    tool,
    setTool,
    linkSource,
    cancelLinkSource: () => setLinkSourceId(null),
    focusedPointId,
    setFocusedPointId,
    focusedPoint,
    focusedItems,
    linkedItemsOf,
    editor,
    pointForm,
    setPointForm,
    linkForm,
    setLinkForm,
    isSaving,
    editPoint,
    editLink,
    closeEditor,
    saveEditor,
    confirm,
    closeConfirm: () => setConfirm(null),
    handleMapPlace,
    handleCreatePointClick,
    handlePointMove,
    startLinkFrom,
    requestDeletePoint,
    requestDeleteLink,
    otherKindOf,
  };
}

export type PointController = ReturnType<typeof usePointController>;

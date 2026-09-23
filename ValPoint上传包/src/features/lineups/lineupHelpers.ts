/**
 * lineupHelpers - 点位工具
 *
 * 职责：
 * - 承载点位工具相关的模块实现。
 * - 组织内部依赖与导出接口。
 * - 为上层功能提供支撑。
 */

import { LineupDbPayload, MapOption, AgentOption, NewLineupForm, LineupSide, LineupPosition, AgentData, BaseLineup } from '../../types/lineup';

export const checkTitleExists = (
  title: string,
  lineups: BaseLineup[],
  agentName: string,
  excludeId?: string | null
): boolean => {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedAgent = agentName.trim().toLowerCase();
  return lineups.some(
    (l) =>
      l.title.trim().toLowerCase() === normalizedTitle &&
      l.agentName.trim().toLowerCase() === normalizedAgent &&
      l.id !== excludeId
  );
};

export const generateUniqueTitle = (
  baseTitle: string,
  lineups: BaseLineup[],
  agentName: string
): string => {
  const normalizedBase = baseTitle.trim();
  if (!checkTitleExists(normalizedBase, lineups, agentName)) {
    return normalizedBase;
  }

  const normalizedAgent = agentName.trim().toLowerCase();
  const agentLineups = lineups.filter(l => l.agentName.trim().toLowerCase() === normalizedAgent);

  const suffixPattern = /-(\d{2})$/;
  const cleanTitle = normalizedBase.replace(suffixPattern, '');

  let maxSuffix = 0;
  agentLineups.forEach((l) => {
    const title = l.title.trim();
    if (title.toLowerCase().startsWith(cleanTitle.toLowerCase())) {
      const match = title.match(suffixPattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxSuffix) maxSuffix = num;
      } else if (title.toLowerCase() === cleanTitle.toLowerCase()) {
        if (maxSuffix === 0) maxSuffix = 0;
      }
    }
  });

  return `${cleanTitle}-${String(maxSuffix + 1).padStart(2, '0')}`;
};

export const createEmptyLineup = (): NewLineupForm => ({
  title: '',
  agentPos: null,
  skillPos: null,
  standImg: '',
  standDesc: '',
  stand2Img: '',
  stand2Desc: '',
  aimImg: '',
  aimDesc: '',
  aim2Img: '',
  aim2Desc: '',
  landImg: '',
  landDesc: '',
  sourceLink: '',
  authorName: '',
  authorAvatar: '',
  authorUid: '',
  enableStand2: false,
  enableAim2: false,
});

type PointSource = Pick<BaseLineup, 'standImg' | 'standDesc' | 'stand2Img' | 'stand2Desc' | 'landImg' | 'landDesc'>;

/**
 * 复用已有站位/落点时，把它的配图与说明带进表单。
 * 只在对应栏目还空着时填写，不覆盖已经填好的内容；sources 按创建时间从早到晚排列，优先取最新一条。
 */
export const fillFormFromPoint = (
  form: NewLineupForm,
  kind: 'stand' | 'land',
  sources: PointSource[],
): NewLineupForm => {
  const newestFirst = [...sources].reverse();
  if (kind === 'stand') {
    if (form.standImg || form.standDesc || form.stand2Img || form.stand2Desc) return form;
    const src = newestFirst.find((s) => s.standImg || s.standDesc || s.stand2Img || s.stand2Desc);
    if (!src) return form;
    return {
      ...form,
      standImg: src.standImg || '',
      standDesc: src.standDesc || '',
      stand2Img: src.stand2Img || '',
      stand2Desc: src.stand2Desc || '',
      enableStand2: form.enableStand2 || !!(src.stand2Img || src.stand2Desc),
    };
  }
  if (form.landImg || form.landDesc) return form;
  const src = newestFirst.find((s) => s.landImg || s.landDesc);
  if (!src) return form;
  return { ...form, landImg: src.landImg || '', landDesc: src.landDesc || '' };
};

/** 站位/落点各自对应的表单栏目 */
export const POINT_FORM_FIELDS = {
  stand: ['standImg', 'standDesc', 'stand2Img', 'stand2Desc', 'enableStand2'],
  land: ['landImg', 'landDesc'],
} as const satisfies Record<'stand' | 'land', readonly (keyof NewLineupForm)[]>;

/** 撤掉之前自动带入、且用户没有改动过的内容 */
export const clearAutoFilledFields = (
  form: NewLineupForm,
  filled: Partial<Record<keyof NewLineupForm, unknown>>,
): NewLineupForm => {
  const next = { ...form };
  (Object.keys(filled) as (keyof NewLineupForm)[]).forEach((field) => {
    if (form[field] !== filled[field]) return;
    (next as Record<string, unknown>)[field] = typeof filled[field] === 'boolean' ? false : '';
  });
  return next;
};

type WritableLineup = {
  title: string;
  mapName: string;
  agentName: string;
  agentIcon?: string | null;
  skillIcon?: string | null;
  side: LineupSide;
  abilityIndex: number | null;
  ability_index?: number | null; // 说明：兼容性字段。
  agentPos: LineupPosition | null;
  skillPos: LineupPosition | null;
  standImg?: string | null;
  standDesc?: string | null;
  stand2Img?: string | null;
  stand2Desc?: string | null;
  aimImg?: string | null;
  aimDesc?: string | null;
  aim2Img?: string | null;
  aim2Desc?: string | null;
  landImg?: string | null;
  landDesc?: string | null;
  sourceLink?: string | null;
  authorName?: string | null;
  authorAvatar?: string | null;
  authorUid?: string | null;
  clonedFrom?: string | null;
  creatorId?: string | null; // 点位创建者的 custom_id
};

export const toDbPayload = (data: WritableLineup, userId: string): LineupDbPayload => ({
  title: data.title,
  map_name: data.mapName,
  agent_name: data.agentName,
  agent_icon: data.agentIcon || null,
  skill_icon: data.skillIcon || null,
  side: data.side,
  ability_index: data.abilityIndex ?? data.ability_index ?? null,
  agent_pos: data.agentPos,
  skill_pos: data.skillPos,
  stand_img: data.standImg || '',
  stand_desc: data.standDesc || '',
  stand2_img: data.stand2Img || '',
  stand2_desc: data.stand2Desc || '',
  aim_img: data.aimImg || '',
  aim_desc: data.aimDesc || '',
  aim2_img: data.aim2Img || '',
  aim2_desc: data.aim2Desc || '',
  land_img: data.landImg || '',
  land_desc: data.landDesc || '',
  source_link: data.sourceLink || '',
  author_name: data.authorName || null,
  author_avatar: data.authorAvatar || null,
  author_uid: data.authorUid || null,
  user_id: userId,
  cloned_from: data.clonedFrom || null,
  creator_id: data.creatorId || null,
});

export const getMapDisplayName = (map: MapOption | null, translations: Record<string, string>) =>
  map ? translations[map.displayName] || map.displayName : '';

export const getMapEnglishName = (displayName: string, translations: Record<string, string>) =>
  Object.keys(translations).find((key) => translations[key] === displayName) || displayName;

export const getAbilityIconSafe = (agent: AgentOption | null, abilityIndex: number | null, getter: any) =>
  agent && abilityIndex !== null ? getter(agent, abilityIndex) : null;

/**
 * normalize - normalize
 *
 * 职责：
 * - 封装normalize相关的接口调用。
 * - 处理参数整理、错误兜底与结果转换。
 * - 向上层提供稳定的服务 API。
 */

import { MAP_TRANSLATIONS } from '../constants/maps';
import { BaseLineup, LineupPoint } from '../types/lineup';

export const normalizeLineup = (raw: any, mapNameZhToEn: Record<string, string>): BaseLineup => {
  const pick = (a: any, b: any) => (a !== undefined ? a : b);
  const mapNameRaw = pick(raw.map_name, raw.mapName);
  return {
    id: raw.id,
    title: pick(raw.title, ''),
    mapName: mapNameZhToEn[mapNameRaw] || mapNameRaw,
    agentName: pick(raw.agent_name, raw.agentName),
    agentIcon: pick(raw.agent_icon, raw.agentIcon),
    skillIcon: pick(raw.skill_icon, raw.skillIcon),
    side: pick(raw.side, 'attack'),
    abilityIndex: pick(raw.ability_index, raw.abilityIndex),
    agentPos: pick(raw.agent_pos, raw.agentPos),
    skillPos: pick(raw.skill_pos, raw.skillPos),
    standImg: pick(raw.stand_img, raw.standImg),
    standDesc: pick(raw.stand_desc, raw.standDesc),
    stand2Img: pick(raw.stand2_img, raw.stand2Img),
    stand2Desc: pick(raw.stand2_desc, raw.stand2Desc),
    aimImg: pick(raw.aim_img, raw.aimImg),
    aimDesc: pick(raw.aim_desc, raw.aimDesc),
    aim2Img: pick(raw.aim2_img, raw.aim2Img),
    aim2Desc: pick(raw.aim2_desc, raw.aim2Desc),
    landImg: pick(raw.land_img, raw.landImg),
    landDesc: pick(raw.land_desc, raw.landDesc),
    sourceLink: pick(raw.source_link, raw.sourceLink),
    authorName: pick(raw.author_name, raw.authorName),
    authorAvatar: pick(raw.author_avatar, raw.authorAvatar),
    authorUid: pick(raw.author_uid, raw.authorUid),
    createdAt: pick(raw.created_at, raw.createdAt),
    updatedAt: pick(raw.updated_at, raw.updatedAt),
    clonedFrom: pick(raw.cloned_from, raw.clonedFrom),
    userId: pick(raw.user_id, raw.userId),
    creatorId: pick(raw.creator_id, raw.creatorId),
    standId: pick(raw.stand_id, raw.standId) ?? null,
    landId: pick(raw.land_id, raw.landId) ?? null,
    isJump: !!pick(raw.is_jump, raw.isJump),
  };
};

export const normalizePoint = (raw: any, mapNameZhToEn: Record<string, string>): LineupPoint => ({
  id: raw.id,
  userId: raw.user_id,
  kind: raw.kind,
  mapName: mapNameZhToEn[raw.map_name] || raw.map_name,
  agentName: raw.agent_name,
  agentIcon: raw.agent_icon ?? null,
  side: raw.side || 'attack',
  abilityIndex: raw.ability_index ?? null,
  skillIcon: raw.skill_icon ?? null,
  pos: raw.pos,
  title: raw.title || '',
  label: raw.label ?? null,
  standImg: raw.stand_img ?? null,
  standDesc: raw.stand_desc ?? null,
  stand2Img: raw.stand2_img ?? null,
  stand2Desc: raw.stand2_desc ?? null,
  landImg: raw.land_img ?? null,
  landDesc: raw.land_desc ?? null,
  createdAt: raw.created_at ?? null,
  updatedAt: raw.updated_at ?? null,
});

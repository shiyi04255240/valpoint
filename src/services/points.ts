/**
 * points - 站位 / 落点
 *
 * 职责：
 * - 封装个人库站位、落点以及它们之间连线的接口调用。
 * - 修改站位 / 落点后，同步更新经过它的连线里保留的位置与图文，保证共享库、下载等旧功能拿到的是最新内容。
 * - 向上层提供稳定的服务 API。
 */

import { supabase } from '../supabaseClient';
import { TABLE } from './tables';
import { normalizeLineup, normalizePoint } from './normalize';
import { BaseLineup, LineupDbPayload, LineupPoint, PointDbPayload } from '../types/lineup';

export type FetchPointsResult = {
  points: LineupPoint[];
  /** 数据库尚未执行站位/落点升级脚本时为 false */
  supported: boolean;
};

const isMissingTableError = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === '42P01' || error.code === 'PGRST205' || /valorant_points/.test(error.message || ''));

export async function fetchPointsApi(userId: string, mapNameZhToEn: Record<string, string>): Promise<FetchPointsResult> {
  const { data, error } = await supabase
    .from(TABLE.points)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (isMissingTableError(error)) return { points: [], supported: false };
  if (error) throw error;
  return { points: (data || []).map((d) => normalizePoint(d, mapNameZhToEn)), supported: true };
}

/** 连线里跟随站位 / 落点变化的字段 */
const linkedFieldsFromPoint = (point: LineupPoint): Partial<LineupDbPayload> =>
  point.kind === 'stand'
    ? {
      agent_pos: point.pos,
      side: point.side,
      stand_img: point.standImg || '',
      stand_desc: point.standDesc || '',
      stand2_img: point.stand2Img || '',
      stand2_desc: point.stand2Desc || '',
    }
    : {
      skill_pos: point.pos,
      ability_index: point.abilityIndex,
      skill_icon: point.skillIcon || null,
      land_img: point.landImg || '',
      land_desc: point.landDesc || '',
    };

export async function createPointApi(payload: PointDbPayload, mapNameZhToEn: Record<string, string>): Promise<LineupPoint> {
  const { data, error } = await supabase.from(TABLE.points).insert(payload).select().single();
  if (error) throw error;
  return normalizePoint(data, mapNameZhToEn);
}

export async function updatePointApi(
  id: string,
  payload: Partial<PointDbPayload>,
  mapNameZhToEn: Record<string, string>,
): Promise<LineupPoint> {
  const { data, error } = await supabase.from(TABLE.points).update(payload).eq('id', id).select().single();
  if (error) throw error;
  const point = normalizePoint(data, mapNameZhToEn);
  const { error: syncError } = await supabase
    .from(TABLE.lineups)
    .update(linkedFieldsFromPoint(point))
    .eq(point.kind === 'stand' ? 'stand_id' : 'land_id', id);
  if (syncError) throw syncError;
  return point;
}

/** 删除站位 / 落点，经过它的连线由数据库一并删除 */
export async function deletePointApi(id: string) {
  const { error } = await supabase.from(TABLE.points).delete().eq('id', id);
  if (error) throw error;
}

export async function clearPointsApi(userId: string, agentName?: string) {
  let query = supabase.from(TABLE.points).delete().eq('user_id', userId);
  if (agentName) query = query.eq('agent_name', agentName);
  const { error } = await query;
  if (isMissingTableError(error)) return;
  if (error) throw error;
}

type LinkExtra = {
  userId: string;
  title: string;
  isJump?: boolean;
  creatorId?: string | null;
};

/** 连线本身也是一条完整的点位记录，带上两端的位置和图文，旧功能可以照常读取 */
export async function createLinkApi(stand: LineupPoint, land: LineupPoint, extra: LinkExtra): Promise<BaseLineup> {
  const now = new Date().toISOString();
  const payload: LineupDbPayload = {
    title: extra.title,
    map_name: stand.mapName,
    agent_name: stand.agentName,
    agent_icon: stand.agentIcon || null,
    skill_icon: land.skillIcon || null,
    side: stand.side,
    ability_index: land.abilityIndex,
    agent_pos: stand.pos,
    skill_pos: land.pos,
    stand_img: stand.standImg || '',
    stand_desc: stand.standDesc || '',
    stand2_img: stand.stand2Img || '',
    stand2_desc: stand.stand2Desc || '',
    aim_img: '',
    aim_desc: '',
    aim2_img: '',
    aim2_desc: '',
    land_img: land.landImg || '',
    land_desc: land.landDesc || '',
    source_link: '',
    user_id: extra.userId,
    creator_id: extra.creatorId || null,
    stand_id: stand.id,
    land_id: land.id,
    is_jump: !!extra.isJump,
    created_at: now,
  };
  const { data, error } = await supabase.from(TABLE.lineups).insert(payload).select().single();
  if (error) throw error;
  return normalizeLineup(data, {});
}

const STAND_IMAGE_FIELDS = ['stand_img', 'stand2_img'] as const;
const LAND_IMAGE_FIELDS = ['land_img'] as const;
const LINK_IMAGE_FIELDS = ['aim_img', 'aim2_img'] as const;

type ImageUrls = Partial<Record<(typeof STAND_IMAGE_FIELDS | typeof LAND_IMAGE_FIELDS | typeof LINK_IMAGE_FIELDS)[number], string | null>>;

/**
 * 从共享库保存到个人库后把图片转存到自己的图床：瞄点图写回这条连线；
 * 站位图 / 落点图写回站位 / 落点（并同步到经过它的所有连线）。
 * 站位 / 落点原本就有自己的图（保存时挂到了已有的点上）时保持不变。
 */
export async function applyTransferredImagesApi(lineup: BaseLineup, oldUrls: ImageUrls, newUrls: ImageUrls) {
  const linkPatch: Partial<LineupDbPayload> = {};
  LINK_IMAGE_FIELDS.forEach((field) => {
    if (newUrls[field]) linkPatch[field] = newUrls[field];
  });
  if (Object.keys(linkPatch).length) {
    const { error } = await supabase
      .from(TABLE.lineups)
      .update({ ...linkPatch, updated_at: new Date().toISOString() })
      .eq('id', lineup.id);
    if (error) throw error;
  }

  const targets: [string | null | undefined, readonly (keyof ImageUrls)[]][] = [
    [lineup.standId, STAND_IMAGE_FIELDS],
    [lineup.landId, LAND_IMAGE_FIELDS],
  ];
  for (const [pointId, fields] of targets) {
    if (!pointId || !fields.some((f) => newUrls[f])) continue;
    const { data, error } = await supabase.from(TABLE.points).select(fields.join(',')).eq('id', pointId).single();
    if (error) throw error;
    const current = (data || {}) as ImageUrls;
    const patch: Partial<PointDbPayload> = {};
    fields.forEach((field) => {
      if (newUrls[field] && (current[field] || null) === (oldUrls[field] || null)) {
        (patch as Record<string, string>)[field] = newUrls[field] as string;
      }
    });
    if (Object.keys(patch).length) await updatePointApi(pointId, patch, {});
  }
}

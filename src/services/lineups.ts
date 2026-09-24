/**
 * lineups - 点位
 *
 * 职责：
 * - 封装点位相关的接口调用。
 * - 处理参数整理、错误兜底与结果转换。
 * - 向上层提供稳定的服务 API。
 */

import { supabase } from '../supabaseClient';
import { TABLE } from './tables';
import { normalizeLineup } from './normalize';
import { clearPointsApi } from './points';
import { BaseLineup, LineupDbPayload } from '../types/lineup';

export async function fetchLineupsApi(userId: string, mapNameZhToEn: Record<string, string>): Promise<BaseLineup[]> {
  const { data, error } = await supabase
    .from(TABLE.lineups)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((d) => normalizeLineup(d, mapNameZhToEn));
}

export async function saveLineupApi(payload: LineupDbPayload): Promise<BaseLineup> {
  const { data, error } = await supabase.from(TABLE.lineups).insert(payload).select().single();
  if (error) throw error;
  return normalizeLineup(data, {});
}

export async function updateLineupApi(id: string, payload: Partial<LineupDbPayload>) {
  const { error } = await supabase.from(TABLE.lineups).update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteLineupApi(id: string) {
  const { error } = await supabase.from(TABLE.lineups).delete().eq('id', id);
  if (error) throw error;
}

export async function findLineupByClone(userId: string, clonedFrom: string) {
  if (!userId || !clonedFrom) return null;
  const { data, error } = await supabase
    .from(TABLE.lineups)
    .select('id')
    .eq('user_id', userId)
    .eq('cloned_from', clonedFrom)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

export async function clearLineupsApi(userId: string) {
  const { error } = await supabase.from(TABLE.lineups).delete().eq('user_id', userId);
  if (error) throw error;
  await clearPointsApi(userId);
}

export async function clearLineupsByAgentApi(userId: string, agentName: string) {
  const { error } = await supabase.from(TABLE.lineups).delete().eq('user_id', userId).eq('agent_name', agentName);
  if (error) throw error;
  await clearPointsApi(userId, agentName);
}

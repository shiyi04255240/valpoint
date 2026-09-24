/**
 * useLineups - 点位
 *
 * 职责：
 * - 封装点位相关的状态与副作用。
 * - 对外提供稳定的接口与回调。
 * - 处理订阅、清理或缓存等生命周期细节。
 *
 * 个人库的站位 / 落点与点位（连线）一起加载，任何刷新点位的地方都会同时刷新它们。
 */

import { useCallback, useState } from 'react';
import { fetchLineupsApi } from '../services/lineups';
import { fetchPointsApi } from '../services/points';
import { BaseLineup, LineupPoint } from '../types/lineup';

export const useLineups = (mapNameZhToEn: Record<string, string>) => {
  const [lineups, setLineups] = useState<BaseLineup[]>([]);
  const [points, setPoints] = useState<LineupPoint[]>([]);
  /** 数据库是否已执行站位/落点升级脚本；未知时为 null */
  const [pointsSupported, setPointsSupported] = useState<boolean | null>(null);

  const fetchLineups = useCallback(
    async (userId: string | null) => {
      if (!userId) return;
      const [list, pointResult] = await Promise.all([
        fetchLineupsApi(userId, mapNameZhToEn),
        fetchPointsApi(userId, mapNameZhToEn),
      ]);
      setLineups(list);
      setPoints(pointResult.points);
      setPointsSupported(pointResult.supported);
    },
    [mapNameZhToEn],
  );

  return { lineups, setLineups, fetchLineups, points, setPoints, pointsSupported };
};

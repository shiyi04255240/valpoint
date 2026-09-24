/**
 * PointDetailPanel - 站位 / 落点详情面板
 *
 * 职责：
 * - 展示地图上被点中的站位（或落点）自己的图文。
 * - 列出与它相连的所有落点（或站位），点一条即可查看这条连线的完整图文。
 * - 提供编辑、删除、继续连线、编辑 / 断开单条连线的入口。
 */

import React, { useState } from 'react';
import Icon from './Icon';
import { KIND_NAME, pointDisplayName } from '../features/lineups/controllers/usePointController';
import type { LinkedItem } from '../features/lineups/controllers/usePointController';
import type { BaseLineup, LineupPoint } from '../types/lineup';
import type { LightboxImage } from '../types/ui';

type Props = {
  point: LineupPoint;
  items: LinkedItem[];
  /** panel：嵌在右侧栏；sheet：手机 / 平板上从底部弹出 */
  variant: 'panel' | 'sheet';
  canEdit: boolean;
  onClose: () => void;
  onOpenLink: (lineupId: string) => void;
  onEditPoint: () => void;
  onDeletePoint: () => void;
  onLinkFrom: () => void;
  onEditLink: (lineup: BaseLineup) => void;
  onDeleteLink: (lineup: BaseLineup) => void;
  onViewImage: (img: LightboxImage) => void;
  /** 切换到另一个站位 / 落点（在详情里来回跳转） */
  onFocusPoint: (id: string) => void;
  /** 每个站位的连线颜色，与地图上一致 */
  standColors: Record<string, string>;
};

const SIDE_TEXT = { attack: '进攻', defense: '防守' } as const;

const ownImages = (p: LineupPoint) =>
  (p.kind === 'stand'
    ? [
      { src: p.standImg, desc: p.standDesc },
      { src: p.stand2Img, desc: p.stand2Desc },
    ]
    : [{ src: p.landImg, desc: p.landDesc }]
  ).filter((img): img is { src: string; desc: string | null | undefined } => !!img.src);

const thumbOf = (p: LineupPoint) => (p.kind === 'stand' ? p.standImg : p.landImg) || null;
const iconOf = (p: LineupPoint) => (p.kind === 'stand' ? p.agentIcon : p.skillIcon) || null;

/** 缩略图加载失败时退回显示角色 / 技能图标 */
const Thumb: React.FC<{ src: string | null; icon: string | null }> = ({ src, icon }) => {
  const [failed, setFailed] = useState(false);
  if (src && !failed) return <img src={src} alt="" className="w-full h-full object-cover" onError={() => setFailed(true)} />;
  if (icon) return <img src={icon} alt="" className="w-7 h-7 object-contain opacity-80" />;
  return <Icon name="Image" size={16} className="text-gray-600" />;
};

const PointDetailPanel: React.FC<Props> = ({
  point,
  items,
  variant,
  canEdit,
  onClose,
  onOpenLink,
  onEditPoint,
  onDeletePoint,
  onLinkFrom,
  onEditLink,
  onDeleteLink,
  onViewImage,
  onFocusPoint,
  standColors,
}) => {
  const otherName = KIND_NAME[point.kind === 'stand' ? 'land' : 'stand'];
  const images = ownImages(point);
  const imageList = images.map((img) => img.src);
  const descList = images.map((img) => img.desc || '');
  const icon = iconOf(point);
  const isSheet = variant === 'sheet';
  const standIdOf = (lineup: BaseLineup) => (point.kind === 'stand' ? point.id : lineup.standId || '');
  const ownColor = point.kind === 'stand' ? standColors[point.id] : items[0] ? standColors[standIdOf(items[0].lineup)] : undefined;

  return (
    <section
      key={point.id}
      aria-label={`${KIND_NAME[point.kind]}详情`}
      className={`vp-panel-in flex flex-col min-h-0 ${isSheet ? 'max-h-[46vh]' : 'h-full'}`}
    >
      {isSheet && <div className="mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-white/20" aria-hidden />}

      <header className={`flex items-start gap-3 px-4 pb-3 shrink-0 ${isSheet ? 'pt-2' : 'pt-4'}`}>
        <span className="relative w-11 h-11 shrink-0 rounded-full border-2 border-[#ff4655] bg-[#0f1923] overflow-hidden flex items-center justify-center">
          {icon ? (
            <img src={icon} alt="" className={point.kind === 'land' ? 'w-[68%] h-[68%] object-contain' : 'w-full h-full object-cover'} />
          ) : (
            <Icon name={point.kind === 'stand' ? 'User' : 'Target'} size={18} className="text-white" />
          )}
          {point.label && (
            <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#f0c75e] text-[#1a1f26] text-[10px] font-black leading-4 text-center">
              {point.label}
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-wider">
            {ownColor && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: ownColor }} aria-hidden />}
            <span className="text-[#ff4655]">{KIND_NAME[point.kind]}</span>
            <span className={point.side === 'attack' ? 'text-red-300/80' : 'text-emerald-300/80'}>{SIDE_TEXT[point.side]}</span>
            <span className="text-gray-500 truncate">{point.agentName}</span>
          </div>
          <h3 className="text-lg font-bold text-white leading-snug truncate">{pointDisplayName(point)}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭详情"
          className="p-2 -mr-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ff4655]"
        >
          <Icon name="X" size={18} />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 pb-4 space-y-5">
        {images.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory -mx-1 px-1 pb-1">
            {images.map((img, idx) => (
              <button
                key={img.src + idx}
                type="button"
                onClick={() => onViewImage({ src: img.src, list: imageList, index: idx, desc: img.desc || '', descList })}
                className={`relative shrink-0 snap-start rounded-lg overflow-hidden border border-white/10 bg-[#0f1923] cursor-zoom-in hover:border-[#ff4655]/70 transition-colors ${isSheet ? 'h-32' : 'aspect-video'} ${images.length > 1 ? 'w-[85%]' : 'w-full'}`}
              >
                <img src={img.src} alt={`${KIND_NAME[point.kind]}图 ${idx + 1}`} className="w-full h-full object-cover" />
                {img.desc && (
                  <span className="absolute inset-x-0 bottom-0 px-2.5 py-1.5 text-left text-xs text-gray-100 leading-snug bg-black/55 backdrop-blur-sm line-clamp-2">
                    {img.desc}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className={`${isSheet ? 'h-24' : 'aspect-video'} rounded-lg border border-dashed border-white/15 bg-[#0f1923] flex flex-col items-center justify-center gap-2 text-sm text-gray-500`}>
            <Icon name="ImageOff" size={22} className="text-gray-600" />
            还没有{KIND_NAME[point.kind]}图
            {canEdit && (
              <button type="button" onClick={onEditPoint} className="text-xs font-bold text-[#ff4655] hover:underline">
                去补图
              </button>
            )}
          </div>
        )}

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <h4 className="text-sm font-bold text-white">
              相连的{otherName}
              <span className="ml-1.5 text-[#ff4655] tabular-nums">{items.length}</span>
            </h4>
            {items.length > 0 && <span className="text-[11px] text-gray-500">点一条查看完整图文</span>}
          </div>

          {items.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-[#0f1923] px-4 py-5 text-center">
              <p className="text-sm text-gray-400">还没有连到任何{otherName}</p>
              {canEdit && (
                <button
                  type="button"
                  onClick={onLinkFrom}
                  className="mt-3 h-9 px-4 rounded-lg bg-[#ff4655] hover:bg-[#ff5b6b] text-white text-sm font-bold transition-colors"
                >
                  + 连到{otherName}
                </button>
              )}
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map(({ lineup, other }, idx) => {
                const thumb = thumbOf(other);
                const otherIcon = iconOf(other);
                return (
                  <li key={lineup.id} className="vp-card-in" style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}>
                    <div
                      className="group relative flex items-stretch rounded-lg border border-white/10 border-l-[3px] bg-[#0f1923] hover:border-[#ff4655]/70 transition-colors overflow-hidden"
                      style={{ borderLeftColor: standColors[standIdOf(lineup)] || undefined }}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenLink(lineup.id)}
                        className="flex flex-1 min-w-0 items-center gap-3 p-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#ff4655]"
                      >
                        <span className="relative w-20 aspect-video shrink-0 rounded-md overflow-hidden bg-[#1f2326] flex items-center justify-center">
                          <Thumb src={thumb} icon={otherIcon} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="text-sm font-bold text-white truncate">{pointDisplayName(other)}</span>
                            {other.label && (
                              <span className="shrink-0 px-1.5 rounded bg-[#f0c75e]/15 text-[#f0c75e] text-[10px] font-black leading-4">{other.label}</span>
                            )}
                            {lineup.isJump && (
                              <span className="shrink-0 px-1.5 rounded bg-[#f0c75e] text-[#1a1f26] text-[10px] font-black leading-4">跳投</span>
                            )}
                          </span>
                          <span className="block text-xs text-gray-500 truncate mt-0.5">{lineup.title}</span>
                          {!lineup.aimImg && <span className="block text-[11px] text-amber-300/70 mt-0.5">还没有瞄点图</span>}
                        </span>
                      </button>
                      <span className="flex flex-col justify-center gap-1 pr-1.5">
                        <button
                          type="button"
                          onClick={() => onFocusPoint(other.id)}
                          aria-label={`定位到${KIND_NAME[other.kind]} ${pointDisplayName(other)}`}
                          title={`定位到这个${KIND_NAME[other.kind]}，看它连着哪些点`}
                          className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                        >
                          <Icon name="LocateFixed" size={14} />
                        </button>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            onClick={() => onEditLink(lineup)}
                            aria-label={`编辑连线 ${lineup.title}`}
                            title="编辑这条连线"
                            className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                          >
                            <Icon name="Pencil" size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteLink(lineup)}
                            aria-label={`断开连线 ${lineup.title}`}
                            title="断开这条连线"
                            className="p-1.5 rounded-md text-gray-500 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                          >
                            <Icon name="Unlink" size={14} />
                          </button>
                        </>
                      )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {canEdit && (
        <footer className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-white/10">
          <button
            type="button"
            onClick={onLinkFrom}
            className="flex-1 h-10 rounded-lg bg-[#ff4655] hover:bg-[#ff5b6b] text-white text-sm font-bold transition-colors"
          >
            + 连到{otherName}
          </button>
          <button
            type="button"
            onClick={onEditPoint}
            className="h-10 px-4 rounded-lg border border-white/15 text-sm font-bold text-gray-200 hover:border-white/40 hover:text-white transition-colors"
          >
            编辑
          </button>
          <button
            type="button"
            onClick={onDeletePoint}
            aria-label={`删除${KIND_NAME[point.kind]}`}
            title={`删除${KIND_NAME[point.kind]}`}
            className="h-10 w-10 rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 transition-colors flex items-center justify-center"
          >
            <Icon name="Trash2" size={16} />
          </button>
        </footer>
      )}
    </section>
  );
};

export default PointDetailPanel;

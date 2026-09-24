/**
 * lineup - 点位
 *
 * 职责：
 * - 声明点位相关的数据结构与类型约束。
 * - 为业务逻辑提供类型安全的契约。
 * - 集中管理跨模块共享的类型定义。
 */

export type LineupSide = 'attack' | 'defense';
export type LibraryMode = 'personal' | 'shared';

export type LineupPosition = {
  lat: number;
  lng: number;
};

export type BaseLineup = {
  id: string;
  title: string;
  mapName: string;
  agentName: string;
  agentIcon?: string | null;
  skillIcon?: string | null;
  side: LineupSide;
  abilityIndex: number | null;
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
  createdAt?: string | null;
  updatedAt?: string | null;
  clonedFrom?: string | null;
  userId?: string | null;
  creatorId?: string | null; // 点位创建者的 custom_id
  /** 连线的起点站位（个人库） */
  standId?: string | null;
  /** 连线的终点落点（个人库） */
  landId?: string | null;
  /** 是否需要跳投 */
  isJump?: boolean;
};

export type PointKind = 'stand' | 'land';
export type PointLabel = 'A' | 'B' | 'C';

/** 个人库中可单独存在的站位 / 落点 */
export type LineupPoint = {
  id: string;
  userId: string;
  kind: PointKind;
  mapName: string;
  agentName: string;
  agentIcon?: string | null;
  side: LineupSide;
  /** 落点对应的技能；站位为 null */
  abilityIndex: number | null;
  skillIcon?: string | null;
  pos: LineupPosition;
  title: string;
  label?: PointLabel | null;
  standImg?: string | null;
  standDesc?: string | null;
  stand2Img?: string | null;
  stand2Desc?: string | null;
  landImg?: string | null;
  landDesc?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type PointDbPayload = {
  user_id: string;
  kind: PointKind;
  map_name: string;
  agent_name: string;
  agent_icon?: string | null;
  side: LineupSide;
  ability_index?: number | null;
  skill_icon?: string | null;
  pos: LineupPosition;
  title: string;
  label?: PointLabel | null;
  stand_img?: string | null;
  stand_desc?: string | null;
  stand2_img?: string | null;
  stand2_desc?: string | null;
  land_img?: string | null;
  land_desc?: string | null;
};

/** 站位 / 落点编辑表单 */
export type PointForm = {
  kind: PointKind;
  pos: LineupPosition | null;
  title: string;
  abilityIndex: number | null;
  label: PointLabel | null;
  standImg: string;
  standDesc: string;
  stand2Img: string;
  stand2Desc: string;
  landImg: string;
  landDesc: string;
  enableStand2: boolean;
};

export type SharedLineup = BaseLineup & {
  sourceId?: string | null;
};

export type AgentOption = { displayName: string; displayIcon?: string | null; uuid?: string };

/** 地图排位池状态：在池/回归/轮出/新增 */
export type MapPoolStatus = 'in-pool' | 'returning' | 'rotated-out' | 'new';

export type MapOption = {
  displayName: string;
  displayIcon?: string | null;
  /** 排位池状态角标 */
  poolStatus?: MapPoolStatus | null;
};

export type AgentRole = 'initiator' | 'sentinel' | 'duelist' | 'controller';

export type Ability = { slot?: string; displayIcon?: string; name?: string; displayName?: string; keypad?: string };
export type AgentData = AgentOption & { abilities?: Ability[], role?: AgentRole };

export type NewLineupForm = {
  title: string;
  agentPos: LineupPosition | null;
  skillPos: LineupPosition | null;
  standImg: string;
  standDesc: string;
  stand2Img: string;
  stand2Desc: string;
  aimImg: string;
  aimDesc: string;
  aim2Img: string;
  aim2Desc: string;
  landImg: string;
  landDesc: string;
  sourceLink: string;
  authorName: string;
  authorAvatar: string;
  authorUid: string;
  enableStand2: boolean;
  enableAim2: boolean;
  isJump?: boolean;
};

export type LineupDbPayload = {
  title: string;
  map_name: string;
  agent_name: string;
  agent_icon?: string | null;
  skill_icon?: string | null;
  side: LineupSide;
  ability_index: number | null;
  agent_pos: LineupPosition | null;
  skill_pos: LineupPosition | null;
  stand_img?: string | null;
  stand_desc?: string | null;
  stand2_img?: string | null;
  stand2_desc?: string | null;
  aim_img?: string | null;
  aim_desc?: string | null;
  aim2_img?: string | null;
  aim2_desc?: string | null;
  land_img?: string | null;
  land_desc?: string | null;
  source_link?: string | null;
  author_name?: string | null;
  author_avatar?: string | null;
  author_uid?: string | null;
  user_id: string;
  cloned_from?: string | null;
  creator_id?: string | null; // 点位创建者的 custom_id
  created_at?: string | null;
  updated_at?: string | null;
  stand_id?: string | null;
  land_id?: string | null;
  is_jump?: boolean;
};

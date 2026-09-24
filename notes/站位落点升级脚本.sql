-- ==========================================
-- ValPoint 站位 / 落点 升级脚本（个人库）
-- ==========================================
-- 作用：
--   1. 新增“站位 / 落点”表 valorant_points，站位和落点可以单独存在。
--   2. 个人点位表 valorant_lineups 增加 stand_id / land_id / is_jump，
--      每条点位就是一条“连线”：从一个站位连到一个落点。
--   3. 把已有点位自动拆成 站位 + 落点 + 连线。只有坐标完全相同（例如当初点选“复用已有站位”建的）
--      且同角色、同攻防的站位才合并为一个；落点还要求技能相同。靠得近但不重合的各自独立，互不覆盖。
--   4. 导入、从共享库保存等仍按“一条点位”写入的旧功能，写入时会自动挂到对应的站位 / 落点上。
--
-- 使用说明：
--   在 Supabase Dashboard -> SQL Editor 中粘贴全部内容后运行。
--   脚本可重复执行；首次执行前会把 valorant_lineups 完整备份到
--   valorant_lineups_backup_before_points，原有数据不会被删除。
-- ==========================================

-- 依赖项（数据库由较早版本的建表脚本创建时补齐，已存在则不变）
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------
-- 1. 站位 / 落点表
-- ------------------------------------------
CREATE TABLE IF NOT EXISTS public.valorant_points (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('stand', 'land')),
    map_name TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    agent_icon TEXT,
    side TEXT NOT NULL DEFAULT 'attack' CHECK (side IN ('attack', 'defense')),
    ability_index INTEGER,
    skill_icon TEXT,
    pos JSONB NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    label TEXT CHECK (label IN ('A', 'B', 'C')),
    stand_img TEXT,
    stand_desc TEXT,
    stand2_img TEXT,
    stand2_desc TEXT,
    land_img TEXT,
    land_desc TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_valorant_points_owner
    ON public.valorant_points (user_id, map_name, agent_name, kind);

DROP TRIGGER IF EXISTS tr_valorant_points_updated_at ON public.valorant_points;
CREATE TRIGGER tr_valorant_points_updated_at
    BEFORE UPDATE ON public.valorant_points
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.valorant_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own points" ON public.valorant_points;
DROP POLICY IF EXISTS "Users can insert own points" ON public.valorant_points;
DROP POLICY IF EXISTS "Users can update own points" ON public.valorant_points;
DROP POLICY IF EXISTS "Users can delete own points" ON public.valorant_points;

CREATE POLICY "Users can view own points" ON public.valorant_points FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert own points" ON public.valorant_points FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own points" ON public.valorant_points FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own points" ON public.valorant_points FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT ALL ON public.valorant_points TO authenticated, service_role;

-- ------------------------------------------
-- 2. 连线字段（删除站位或落点时，经过它的连线一并删除）
-- ------------------------------------------
ALTER TABLE public.valorant_lineups ADD COLUMN IF NOT EXISTS stand_id UUID REFERENCES public.valorant_points(id) ON DELETE CASCADE;
ALTER TABLE public.valorant_lineups ADD COLUMN IF NOT EXISTS land_id UUID REFERENCES public.valorant_points(id) ON DELETE CASCADE;
ALTER TABLE public.valorant_lineups ADD COLUMN IF NOT EXISTS is_jump BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_valorant_lineups_stand_id ON public.valorant_lineups (stand_id);
CREATE INDEX IF NOT EXISTS idx_valorant_lineups_land_id ON public.valorant_lineups (land_id);

-- ------------------------------------------
-- 3. 首次执行时备份原有点位（只备份一次，不对外开放读取）
-- ------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.valorant_lineups_backup_before_points') IS NULL THEN
        CREATE TABLE public.valorant_lineups_backup_before_points AS TABLE public.valorant_lineups;
        ALTER TABLE public.valorant_lineups_backup_before_points ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- ------------------------------------------
-- 4. 找到坐标重合的已有站位 / 落点，没有就新建（相距不超过 1 个坐标单位视为重合，只为兼容小数误差）
--    新建的点沿用原点位的创建时间，站位的连线颜色按创建先后分配，这样颜色稳定
-- ------------------------------------------
DROP FUNCTION IF EXISTS public.vp_find_or_create_point(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.vp_find_or_create_point(
    p_user UUID,
    p_kind TEXT,
    p_map TEXT,
    p_agent TEXT,
    p_side TEXT,
    p_ability INTEGER,
    p_pos JSONB,
    p_agent_icon TEXT,
    p_skill_icon TEXT,
    p_title TEXT,
    p_img TEXT,
    p_desc TEXT,
    p_img2 TEXT,
    p_desc2 TEXT,
    p_created TIMESTAMPTZ
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
    v_img TEXT;
    v_img2 TEXT;
    v_lat DOUBLE PRECISION := (p_pos->>'lat')::DOUBLE PRECISION;
    v_lng DOUBLE PRECISION := (p_pos->>'lng')::DOUBLE PRECISION;
BEGIN
    SELECT p.id INTO v_id
    FROM public.valorant_points p
    WHERE p.user_id = p_user
      AND p.kind = p_kind
      AND p.map_name = p_map
      AND p.agent_name = p_agent
      AND p.side = p_side
      AND (p_kind = 'stand' OR p.ability_index IS NOT DISTINCT FROM p_ability)
      AND sqrt(power((p.pos->>'lat')::DOUBLE PRECISION - v_lat, 2) + power((p.pos->>'lng')::DOUBLE PRECISION - v_lng, 2)) <= 1
    ORDER BY sqrt(power((p.pos->>'lat')::DOUBLE PRECISION - v_lat, 2) + power((p.pos->>'lng')::DOUBLE PRECISION - v_lng, 2)), p.created_at
    LIMIT 1;

    IF v_id IS NULL THEN
        IF p_kind = 'stand' THEN
            INSERT INTO public.valorant_points (user_id, kind, map_name, agent_name, agent_icon, side, pos, title, stand_img, stand_desc, stand2_img, stand2_desc, created_at)
            VALUES (p_user, 'stand', p_map, p_agent, p_agent_icon, p_side, p_pos, COALESCE(p_title, ''), p_img, p_desc, p_img2, p_desc2, COALESCE(p_created, NOW()))
            RETURNING id INTO v_id;
        ELSE
            INSERT INTO public.valorant_points (user_id, kind, map_name, agent_name, agent_icon, side, ability_index, skill_icon, pos, title, land_img, land_desc, created_at)
            VALUES (p_user, 'land', p_map, p_agent, p_agent_icon, p_side, p_ability, p_skill_icon, p_pos, COALESCE(p_title, ''), p_img, p_desc, COALESCE(p_created, NOW()))
            RETURNING id INTO v_id;
        END IF;
        RETURN v_id;
    END IF;

    -- 已有的点缺图或缺说明时，用这次写入的内容补上；
    -- 站位已有站位图而这次带来的是另一张时，放进“站位图2”，两张都保留，不覆盖
    IF p_kind = 'stand' THEN
        SELECT stand_img, stand2_img INTO v_img, v_img2 FROM public.valorant_points WHERE id = v_id;
        IF COALESCE(v_img, '') = '' THEN
            UPDATE public.valorant_points SET
                stand_img = p_img,
                stand_desc = COALESCE(NULLIF(stand_desc, ''), p_desc),
                stand2_img = COALESCE(NULLIF(stand2_img, ''), p_img2),
                stand2_desc = COALESCE(NULLIF(stand2_desc, ''), p_desc2)
            WHERE id = v_id;
        ELSIF COALESCE(v_img2, '') = '' AND COALESCE(p_img, '') <> '' AND p_img <> v_img THEN
            UPDATE public.valorant_points SET stand2_img = p_img, stand2_desc = p_desc WHERE id = v_id;
        END IF;
    ELSE
        UPDATE public.valorant_points SET
            land_img = COALESCE(NULLIF(land_img, ''), p_img),
            land_desc = COALESCE(NULLIF(land_desc, ''), p_desc),
            skill_icon = COALESCE(NULLIF(skill_icon, ''), p_skill_icon)
        WHERE id = v_id;
    END IF;

    -- 经过这个点的已有连线里保存着一份站位 / 落点图文，补图后一起更新
    IF p_kind = 'stand' THEN
        UPDATE public.valorant_lineups v SET
            stand_img = p.stand_img, stand_desc = p.stand_desc, stand2_img = p.stand2_img, stand2_desc = p.stand2_desc
        FROM public.valorant_points p
        WHERE p.id = v_id AND v.stand_id = v_id;
    ELSE
        UPDATE public.valorant_lineups v SET
            land_img = p.land_img, land_desc = p.land_desc
        FROM public.valorant_points p
        WHERE p.id = v_id AND v.land_id = v_id;
    END IF;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------
-- 5. 写入连线时：没指定站位 / 落点的按坐标挂上去，并带上站位 / 落点的位置和图文
-- ------------------------------------------
CREATE OR REPLACE FUNCTION public.vp_lineup_attach_points()
RETURNS TRIGGER AS $$
DECLARE
    s public.valorant_points%ROWTYPE;
    l public.valorant_points%ROWTYPE;
BEGIN
    IF NEW.stand_id IS NULL AND NEW.agent_pos IS NOT NULL AND NEW.user_id IS NOT NULL THEN
        NEW.stand_id := public.vp_find_or_create_point(
            NEW.user_id, 'stand', NEW.map_name, NEW.agent_name, COALESCE(NEW.side, 'attack'), NULL, NEW.agent_pos,
            NEW.agent_icon, NULL, NEW.title, NEW.stand_img, NEW.stand_desc, NEW.stand2_img, NEW.stand2_desc, NEW.created_at);
    END IF;
    IF NEW.land_id IS NULL AND NEW.skill_pos IS NOT NULL AND NEW.user_id IS NOT NULL THEN
        NEW.land_id := public.vp_find_or_create_point(
            NEW.user_id, 'land', NEW.map_name, NEW.agent_name, COALESCE(NEW.side, 'attack'), NEW.ability_index, NEW.skill_pos,
            NEW.agent_icon, NEW.skill_icon, NEW.title, NEW.land_img, NEW.land_desc, NULL, NULL, NEW.created_at);
    END IF;

    IF NEW.stand_id IS NOT NULL THEN
        SELECT * INTO s FROM public.valorant_points WHERE id = NEW.stand_id;
        IF FOUND THEN
            NEW.agent_pos := s.pos;
            NEW.map_name := s.map_name;
            NEW.agent_name := s.agent_name;
            NEW.agent_icon := COALESCE(s.agent_icon, NEW.agent_icon);
            NEW.side := s.side;
            NEW.stand_img := s.stand_img;
            NEW.stand_desc := s.stand_desc;
            NEW.stand2_img := s.stand2_img;
            NEW.stand2_desc := s.stand2_desc;
        END IF;
    END IF;
    IF NEW.land_id IS NOT NULL THEN
        SELECT * INTO l FROM public.valorant_points WHERE id = NEW.land_id;
        IF FOUND THEN
            NEW.skill_pos := l.pos;
            NEW.ability_index := l.ability_index;
            NEW.skill_icon := COALESCE(l.skill_icon, NEW.skill_icon);
            NEW.land_img := l.land_img;
            NEW.land_desc := l.land_desc;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_valorant_lineups_attach_points ON public.valorant_lineups;
CREATE TRIGGER tr_valorant_lineups_attach_points
    BEFORE INSERT ON public.valorant_lineups
    FOR EACH ROW EXECUTE FUNCTION public.vp_lineup_attach_points();

-- ------------------------------------------
-- 6. 整理已有点位（按创建时间从早到晚，保证合并结果稳定）
-- ------------------------------------------
DO $$
DECLARE
    r public.valorant_lineups%ROWTYPE;
    v_stand UUID;
    v_land UUID;
BEGIN
    FOR r IN
        SELECT * FROM public.valorant_lineups
        WHERE (stand_id IS NULL OR land_id IS NULL)
          AND agent_pos IS NOT NULL AND skill_pos IS NOT NULL AND user_id IS NOT NULL
        ORDER BY created_at NULLS FIRST, id
    LOOP
        v_stand := COALESCE(r.stand_id, public.vp_find_or_create_point(
            r.user_id, 'stand', r.map_name, r.agent_name, COALESCE(r.side, 'attack'), NULL, r.agent_pos,
            r.agent_icon, NULL, r.title, r.stand_img, r.stand_desc, r.stand2_img, r.stand2_desc, r.created_at));
        v_land := COALESCE(r.land_id, public.vp_find_or_create_point(
            r.user_id, 'land', r.map_name, r.agent_name, COALESCE(r.side, 'attack'), r.ability_index, r.skill_pos,
            r.agent_icon, r.skill_icon, r.title, r.land_img, r.land_desc, NULL, NULL, r.created_at));
        UPDATE public.valorant_lineups SET stand_id = v_stand, land_id = v_land WHERE id = r.id;
    END LOOP;
END $$;

-- 合并后同一站位 / 落点的连线统一使用它的位置和图文（原内容见备份表）
UPDATE public.valorant_lineups v SET
    agent_pos = s.pos,
    side = s.side,
    stand_img = s.stand_img,
    stand_desc = s.stand_desc,
    stand2_img = s.stand2_img,
    stand2_desc = s.stand2_desc
FROM public.valorant_points s
WHERE v.stand_id = s.id;

UPDATE public.valorant_lineups v SET
    skill_pos = l.pos,
    land_img = l.land_img,
    land_desc = l.land_desc
FROM public.valorant_points l
WHERE v.land_id = l.id;

NOTIFY pgrst, 'reload schema';

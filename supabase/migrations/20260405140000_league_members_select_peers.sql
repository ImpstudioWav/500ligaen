-- Let authenticated users read all league_members rows for leagues they belong to.
-- Needed for league chat @mentions (and similar features) without exposing other leagues.

DROP POLICY IF EXISTS "league_members_select_same_league" ON public.league_members;

CREATE POLICY "league_members_select_same_league"
ON public.league_members
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.league_members AS me
    WHERE me.league_id = league_members.league_id
      AND me.user_id = auth.uid()
  )
);

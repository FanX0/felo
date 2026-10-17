-- Migration: 0022_optimized_user_search.sql
-- High-performance user and friend search with multi-tier relevance ranking.
-- Designed to handle high-scale user tables (100k - 10M+ users) without full-table scans.

-- 1. Enable pg_trgm extension for fast substring and fuzzy similarity indexing
create extension if not exists pg_trgm;

-- 2. Fast prefix search indexes (B-tree with text_pattern_ops for sub-millisecond prefix searches)
create index if not exists profiles_username_prefix_idx
  on public.profiles (lower(username) text_pattern_ops);

create index if not exists profiles_display_name_prefix_idx
  on public.profiles (lower(display_name) text_pattern_ops);

-- 3. Inverted trigram GIN indexes to accelerate ILIKE / substring searches
create index if not exists profiles_username_trgm_idx
  on public.profiles using gin (lower(username) gin_trgm_ops);

create index if not exists profiles_display_name_trgm_idx
  on public.profiles using gin (lower(display_name) gin_trgm_ops);

-- 4. Industry-standard search RPC function with multi-tier relevance ranking
create or replace function public.search_profiles(
  search_query text,
  result_limit int default 8
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  clean_term text;
  escaped_prefix text;
  escaped_contains text;
  max_results int;
begin
  -- Sanitize query: strip leading '@' handles, trim whitespace, normalize to lowercase
  clean_term := lower(trim(regexp_replace(coalesce(search_query, ''), '^[@\s]+', '', 'g')));

  -- Require minimum 2 characters for performance
  if length(clean_term) < 2 then
    return;
  end if;

  max_results := least(greatest(coalesce(result_limit, 8), 1), 50);

  -- Escape wildcard characters so literal underscores in usernames are preserved
  escaped_prefix := regexp_replace(clean_term, '([%_\\])', '\\\1', 'g') || '%';
  escaped_contains := '%' || regexp_replace(clean_term, '([%_\\])', '\\\1', 'g') || '%';

  return query
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url
  from public.profiles p
  where
    -- Exclude caller profile if signed in
    (auth.uid() is null or p.id <> auth.uid())
    and (
      lower(p.username) like escaped_prefix
      or lower(p.display_name) like escaped_prefix
      or lower(p.username) like escaped_contains
      or lower(p.display_name) like escaped_contains
    )
  order by
    -- Multi-tier relevance ranking:
    case
      -- Tier 1: Exact username match (Highest relevance)
      when lower(p.username) = clean_term then 1
      -- Tier 2: Exact display name match
      when lower(p.display_name) = clean_term then 2
      -- Tier 3: Username starts with query
      when lower(p.username) like escaped_prefix then 3
      -- Tier 4: Display name starts with query
      when lower(p.display_name) like escaped_prefix then 4
      -- Tier 5: Username contains query
      when lower(p.username) like escaped_contains then 5
      -- Tier 6: Display name contains query
      else 6
    end asc,
    -- Secondary ranking: shorter handles closer to search query, then alphabetical
    length(p.username) asc,
    p.username asc
  limit max_results;
end;
$$;

-- Grant execution permissions to authenticated and anonymous users
grant execute on function public.search_profiles(text, int) to authenticated, anon;

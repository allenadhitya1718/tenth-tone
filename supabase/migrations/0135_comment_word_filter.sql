-- ============================================================
-- 0135_comment_word_filter.sql
--
-- COMMENTS-09 (test run 2026-10-19): "fuck you bitch" and "you are a stupid
-- idiot" were posted as comments and stayed visible to everybody.
--
-- Why nothing stopped them:
--   * There was NO server-side text filter on comments at all. The only
--     screen was the AI check (moderate-content, 0066), and the app runs it
--     ALONGSIDE the insert (mobile/src/api/comments.ts postComment): the row
--     is written first and only withdrawn later if the verdict is 'block'.
--     Every failure path (timeout, 429 over the per-user limit from 0120,
--     circuit breaker, offline) fails OPEN, so the row simply stands.
--   * Even when the AI answers, it does not block plain insults. Its
--     harassment block bar is 0.92 (the loosest bar, by design) and its
--     prompt tells the model that insults and profanity "score low on
--     harassment at most". An insult lands in the 0.40-0.92 band: 'review'
--     (published and queued for a human), never 'block'.
--   * hidden_words (0028) is a per-VIEWER filter the viewer fills in
--     themselves; it is empty by default and hides nothing from others.
--
-- Fix: a deterministic word filter in the database, in front of the insert,
-- so it cannot be skipped by a client, a timeout or a quota:
--   public.blocked_words      Arabic + English list, editable by admins.
--   public.abuse_normalize()  lower case; Arabic letter variants folded
--                             (أ إ آ ٱ -> ا, ى/ی -> ي, ة -> ه, ؤ -> و, ئ -> ي,
--                             ک -> ك); harakat, tatweel and zero-width marks
--                             stripped; leetspeak folded (0->o 1->i 3->e
--                             4->a 5->s 7->t 8->b @->a $->s); in-word
--                             punctuation removed (f.u.c.k, f*ck -> fck);
--                             everything else becomes a single space.
--   public.abuse_match()      returns the matched entry or null. Checks the
--                             normalized text, the text with 3+ repeats
--                             squeezed to 2 ("asssshole"), and with all
--                             repeats squeezed ("fuuuuck", "كلللللب").
--   BEFORE INSERT / UPDATE OF text triggers on comments and live_comments
--   that raise 'comment_blocked' (SQLSTATE 23514). The app maps that message
--   to a translated "keep it respectful" alert.
--
-- Two severities, to keep false positives down:
--   severe    blocked anywhere as a whole word (+ common suffixes).
--   directed  ordinary words that are only an insult when aimed at someone:
--             blocked after a second-person marker within a few words
--             ("you ... idiot", "u r so stupid", "يا حمار", "انت والله غبي").
--             "that's a stupid rule" and "كلبي الصغير" pass.
-- Whole-word matching avoids the Scunthorpe problem ("class", "assassin",
-- "كسر" all pass).
--
-- The AI check stays as the second layer, unchanged.
--
-- Safe to re-run: create-or-replace everywhere, the seed uses ON CONFLICT,
-- and the normalized column is recomputed for every row at the end.
-- Not covered here: direct messages (private; screening them is a separate
-- product decision) and video captions (publish has its own AI check).
-- ============================================================

-- ── 1. Normalizer ──
create or replace function public.abuse_normalize(p_text text)
returns text
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare t text;
begin
  if p_text is null then return ''; end if;
  t := lower(p_text);
  -- Arabic letter variants (and the Persian/Urdu forms people type).
  t := translate(t, 'أإآٱىیةؤئکڪہ', 'ااااييهويككه');
  -- Harakat, superscript alef, tatweel, zero-width and direction marks.
  t := regexp_replace(t, '[ً-ٰٟـ​-‏‪-‮⁦-⁩﻿]', '', 'g');
  -- Leetspeak.
  t := translate(t, '0134578@$', 'oieastbas');
  -- Punctuation INSIDE a word is dropped (f.u.c.k, f*ck, b!tch, b-i-t-c-h).
  t := regexp_replace(t, '([a-zء-ي])[''’`*._!|-]+(?=[a-zء-ي])', '\1', 'g');
  -- Everything that is not a Latin or Arabic letter separates words.
  t := regexp_replace(t, '[^a-zء-ي]+', ' ', 'g');
  return btrim(t);
end;
$$;

-- Runs of three or more of the same character -> two.
create or replace function public.abuse_squeeze3(p_text text)
returns text language plpgsql immutable parallel safe set search_path = public as $$
declare t text := coalesce(p_text, ''); n text;
begin
  loop
    n := regexp_replace(t, '(.)\1\1', '\1\1', 'g');
    exit when n = t;
    t := n;
  end loop;
  return t;
end;
$$;

-- Every run of the same character -> one.
create or replace function public.abuse_squeeze1(p_text text)
returns text language plpgsql immutable parallel safe set search_path = public as $$
declare t text := coalesce(p_text, ''); n text;
begin
  loop
    n := regexp_replace(t, '(.)\1', '\1', 'g');
    exit when n = t;
    t := n;
  end loop;
  return t;
end;
$$;

-- ── 2. The list ──
create table if not exists public.blocked_words (
  id         bigint generated always as identity primary key,
  word       text not null unique,
  norm       text not null default '',
  lang       text not null default 'en' check (lang in ('en', 'ar')),
  severity   text not null default 'severe' check (severity in ('severe', 'directed')),
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.blocked_words_set_norm()
returns trigger language plpgsql set search_path = public as $$
begin
  new.norm := public.abuse_normalize(new.word);
  return new;
end;
$$;

drop trigger if exists trg_blocked_words_norm on public.blocked_words;
create trigger trg_blocked_words_norm
  before insert or update of word on public.blocked_words
  for each row execute function public.blocked_words_set_norm();

alter table public.blocked_words enable row level security;
revoke all on public.blocked_words from anon;
-- Admins manage it from the dashboard; nobody else can read it (a readable
-- list is a list of what to misspell).
drop policy if exists "blocked words admin" on public.blocked_words;
create policy "blocked words admin" on public.blocked_words
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- English: severe (anywhere as a word, with -s/-es/-ed/-er/-ers/-ing/-in/-y).
insert into public.blocked_words (word, lang, severity) values
  ('fuck','en','severe'), ('fck','en','severe'), ('fuk','en','severe'), ('fuq','en','severe'),
  ('fking','en','severe'), ('fcking','en','severe'), ('phuck','en','severe'), ('fucc','en','severe'),
  ('motherfucker','en','severe'), ('motherfuckin','en','severe'), ('mofo','en','severe'),
  ('stfu','en','severe'), ('gtfo','en','severe'),
  ('shit','en','severe'), ('bullshit','en','severe'), ('shithead','en','severe'),
  ('bitch','en','severe'), ('biatch','en','severe'), ('btch','en','severe'),
  ('cunt','en','severe'), ('whore','en','severe'), ('slut','en','severe'),
  ('bastard','en','severe'), ('asshole','en','severe'), ('arsehole','en','severe'),
  ('dickhead','en','severe'), ('twat','en','severe'), ('wanker','en','severe'),
  ('pussy','en','severe'), ('cocksucker','en','severe'), ('dipshit','en','severe'),
  ('nigger','en','severe'), ('nigga','en','severe'), ('faggot','en','severe'), ('fag','en','severe'),
  ('kys','en','severe'), ('kill yourself','en','severe'), ('kill urself','en','severe'),
  ('kill yourselves','en','severe'), ('go die','en','severe'), ('hope you die','en','severe'),
  ('son of a whore','en','severe')
on conflict (word) do nothing;

-- English: directed (only after you / u / ur / youre within three words).
insert into public.blocked_words (word, lang, severity) values
  ('stupid','en','directed'), ('idiot','en','directed'), ('moron','en','directed'),
  ('dumb','en','directed'), ('dumbass','en','directed'), ('jackass','en','directed'),
  ('loser','en','directed'), ('retard','en','directed'), ('retarded','en','directed'),
  ('imbecile','en','directed'), ('worthless','en','directed'), ('pathetic','en','directed'),
  ('ugly','en','directed'), ('trash','en','directed'), ('garbage','en','directed'),
  ('scum','en','directed'), ('pig','en','directed'), ('freak','en','directed'),
  ('jerk','en','directed'), ('dick','en','directed'), ('prick','en','directed'),
  ('cock','en','directed'), ('douche','en','directed'), ('douchebag','en','directed'),
  ('disgusting','en','directed'), ('donkey','en','directed'), ('dog','en','directed')
on conflict (word) do nothing;

-- Arabic: severe (anywhere, with و / يا / ال in front and pronoun suffixes).
insert into public.blocked_words (word, lang, severity) values
  ('كس','ar','severe'), ('كسمك','ar','severe'), ('كس امك','ar','severe'), ('كس اختك','ar','severe'),
  ('زب','ar','severe'), ('زبي','ar','severe'), ('طيز','ar','severe'),
  ('شرموط','ar','severe'), ('شرموطه','ar','severe'), ('شراميط','ar','severe'),
  ('قحبه','ar','severe'), ('قحاب','ar','severe'),
  ('منيوك','ar','severe'), ('منيوكه','ar','severe'), ('متناك','ar','severe'),
  ('نيك','ar','severe'), ('انيك','ar','severe'), ('ينيك','ar','severe'), ('نيكك','ar','severe'),
  ('عرص','ar','severe'), ('معرص','ar','severe'), ('عرصه','ar','severe'),
  ('قواد','ar','severe'), ('ديوث','ar','severe'), ('لوطي','ar','severe'),
  ('زاني','ar','severe'), ('زانيه','ar','severe'), ('خرا','ar','severe'),
  ('ابن الكلب','ar','severe'), ('ابن كلب','ar','severe'), ('بنت الكلب','ar','severe'),
  ('ابن الحرام','ar','severe'), ('ولد الحرام','ar','severe'), ('بنت الحرام','ar','severe'),
  ('ابن الزنا','ar','severe'), ('ولد الزنا','ar','severe'),
  ('ابن القحبه','ar','severe'), ('ابن الشرموطه','ar','severe'), ('ابن المتناكه','ar','severe'),
  ('يلعن ابوك','ar','severe'), ('يلعن امك','ar','severe'), ('يلعن دينك','ar','severe'),
  ('يلعن شكلك','ar','severe'), ('يلعنك','ar','severe'), ('الله يلعنك','ar','severe'),
  ('تفو عليك','ar','severe')
on conflict (word) do nothing;

-- Arabic: directed (after يا / انت / انتي / انتم / انتو within two words).
insert into public.blocked_words (word, lang, severity) values
  ('كلب','ar','directed'), ('كلبه','ar','directed'), ('كلاب','ar','directed'),
  ('حمار','ar','directed'), ('حماره','ar','directed'), ('حمير','ar','directed'),
  ('حيوان','ar','directed'), ('حيوانه','ar','directed'), ('بهيمه','ar','directed'), ('بهيم','ar','directed'),
  ('خنزير','ar','directed'), ('خنازير','ar','directed'),
  ('غبي','ar','directed'), ('غبيه','ar','directed'), ('اغبياء','ar','directed'),
  ('حقير','ar','directed'), ('حقيره','ar','directed'), ('وسخ','ar','directed'), ('وسخه','ar','directed'),
  ('قذر','ar','directed'), ('قذره','ar','directed'), ('زباله','ar','directed'),
  ('تافه','ar','directed'), ('تافهه','ar','directed'), ('جزمه','ar','directed'),
  ('واطي','ar','directed'), ('سافل','ar','directed'), ('سافله','ar','directed'),
  ('نذل','ar','directed'), ('اهبل','ar','directed'), ('هبله','ar','directed'),
  ('عبيط','ar','directed'), ('متخلف','ar','directed'), ('متخلفه','ar','directed'),
  ('معاق','ar','directed'), ('منحط','ar','directed'), ('ساقط','ar','directed'), ('ساقطه','ar','directed'),
  ('خول','ar','directed'), ('شاذ','ar','directed'), ('مخنث','ar','directed'),
  ('فاشل','ar','directed'), ('فاشله','ar','directed')
on conflict (word) do nothing;

-- Recompute every row (also the ones a previous run of this file wrote with
-- an older normalizer). The trigger only fires on a change of word.
update public.blocked_words set norm = public.abuse_normalize(word)
 where norm is distinct from public.abuse_normalize(word);

-- ── 3. Matcher ──
-- Returns the matched list entry, or null when the text is clean. Entries are
-- letters and spaces only after normalization, so they are safe to splice
-- into a pattern.
create or replace function public.abuse_match(p_text text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v1 text; v2 text; v3 text;
  r record;
  pat text;
  en_you   constant text := '(^| )(you|u|youre|ur|yu|ya|yo|youare|uare|ure)( [a-z]+){0,3} ';
  en_sev_suffix constant text := '(s|es|ed|er|ers|ing|in|y)?( |$)';
  ar_you   constant text := '(^| )(يا|انت|انتي|انتو|انتم|انته|ياال|يال)( [^ ]+){0,2} (ال)?';
begin
  if p_text is null or btrim(p_text) = '' then return null; end if;
  v1 := public.abuse_normalize(p_text);
  if v1 = '' then return null; end if;
  v3 := public.abuse_squeeze3(v1);
  v2 := public.abuse_squeeze1(v1);

  for r in select word, norm, lang, severity from public.blocked_words
            where enabled and norm <> '' loop
    if r.lang = 'ar' then
      if r.severity = 'severe' then
        pat := '(^| )(و)?(يا ?|يال)?(ال)?' || r.norm || '(ه|ها|ك|كم|كي|ين|ات|هم)?( |$)';
      else
        pat := '(' || ar_you || r.norm || '(ه|ين|ات)?( |$))|((^| )يا(ال)?' || r.norm || '(ه|ين|ات)?( |$))';
      end if;
    else
      if r.severity = 'severe' then
        pat := '(^| )' || r.norm || en_sev_suffix;
      else
        pat := en_you || r.norm || '(s|es)?( |$)';
      end if;
    end if;

    if v1 ~ pat or v3 ~ pat then return r.word; end if;
    -- The fully squeezed text is only compared with entries that have no
    -- doubled letter themselves (squeezing them would change the entry).
    if r.norm !~ '(.)\1' and v2 ~ pat then return r.word; end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.abuse_match(text) from public, anon, authenticated;
revoke all on function public.abuse_normalize(text) from anon;

-- ── 4. Triggers ──
-- The message is the code: the app matches on it and shows its own
-- translated text. 23514 is what the rate limits (0050) use as well.
create or replace function public.check_comment_words()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.abuse_match(new.text) is not null then
    raise exception 'comment_blocked'
      using errcode = 'check_violation',
            hint = 'The comment contains a blocked word (0135).';
  end if;
  return new;
end;
$$;

revoke all on function public.check_comment_words() from public, anon, authenticated;

drop trigger if exists trg_comment_words on public.comments;
create trigger trg_comment_words
  before insert or update of text on public.comments
  for each row execute function public.check_comment_words();

drop trigger if exists trg_live_comment_words on public.live_comments;
create trigger trg_live_comment_words
  before insert or update of text on public.live_comments
  for each row execute function public.check_comment_words();

-- ── 5. Checks ──
-- An end-to-end probe: inserts a bad and a good comment on an existing video
-- inside a sub-transaction that is always rolled back, so nothing is left
-- behind (no row, no notification, no counter change).
create or replace function pg_temp.probe_comment_filter()
returns text
language plpgsql
as $$
declare v_video uuid; v_user uuid; v_bad text := 'not rejected'; v_good text := 'not tried';
begin
  select id, user_id into v_video, v_user from public.videos order by created_at desc limit 1;
  if v_video is null then return 'SKIPPED (no videos)'; end if;

  begin
    insert into public.comments (video_id, user_id, text) values (v_video, v_user, 'fuck you bitch');
    raise exception 'probe_rollback';
  exception when others then
    if sqlerrm = 'comment_blocked' then v_bad := 'rejected'; else v_bad := 'other error: ' || sqlerrm; end if;
  end;

  begin
    insert into public.comments (video_id, user_id, text) values (v_video, v_user, 'Great video, thanks for sharing!');
    raise exception 'probe_rollback';
  exception when others then
    if sqlerrm = 'probe_rollback' then v_good := 'accepted'; else v_good := 'error: ' || sqlerrm; end if;
  end;

  if v_bad = 'rejected' and v_good = 'accepted' then return 'OK'; end if;
  return 'FAIL (bad: ' || v_bad || ', good: ' || v_good || ')';
end;
$$;

with cases(label, input, expect_blocked) as (values
  ('en severe',            'fuck you bitch',                       true),
  ('en directed',          'you are a stupid idiot',               true),
  ('en leet + stretch',    'f.u.c.k y0u b1tchhhh',                 true),
  ('en asterisk',          'what a f*cking b!tch',                 true),
  ('en kill yourself',     'just kys',                             true),
  ('en clean',             'This is a really nice video, I love it!', false),
  ('en not aimed',         'that was a stupid rule honestly',      false),
  ('en scunthorpe',        'classic assassin class in Scunthorpe', false),
  ('ar directed',          'يا حمار',                               true),
  ('ar directed attached', 'ياكلب',                                 true),
  ('ar elongated',         'انت غبيييي والله',                      true),
  ('ar diacritics',        'يا حِمَارْ',                              true),
  ('ar severe',            'يلعن ابوك',                             true),
  ('ar severe phrase',     'يا ابن الكلب',                          true),
  ('ar severe tatweel',    'شرمـــوطة',                             true),
  ('ar clean',             'ما شاء الله فيديو رائع',                 false),
  ('ar pet',               'كلبي الصغير يحب اللعب',                  false),
  ('ar break',             'لا تكسر الباب',                          false)
)
select 'filter: ' || label as item,
       case when (public.abuse_match(input) is not null) = expect_blocked then 'OK'
            else 'FAIL (matched: ' || coalesce(public.abuse_match(input), 'nothing') || ')' end as result
  from cases
union all
select 'blocked_words seeded',
       case when (select count(*) from public.blocked_words where norm <> '')  >= 100 then 'OK' else 'CHECK' end
union all
select 'trigger on comments',
       case when exists (select 1 from pg_trigger where tgname = 'trg_comment_words'
                          and tgrelid = 'public.comments'::regclass and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'trigger on live_comments',
       case when exists (select 1 from pg_trigger where tgname = 'trg_live_comment_words'
                          and tgrelid = 'public.live_comments'::regclass and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'abuse_match not callable from the API',
       case when not has_function_privilege('authenticated', 'public.abuse_match(text)', 'execute')
             and not has_function_privilege('anon', 'public.abuse_match(text)', 'execute')
            then 'OK' else 'EXPOSED' end
union all
select 'insert probe (rolled back)', pg_temp.probe_comment_filter()
order by 1;

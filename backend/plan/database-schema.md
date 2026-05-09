# Supabase Schema Design

## 1. Overview

Supabase covers three needs in one service:
- **PostgreSQL** — narrative state, characters, scenes, save sessions
- **Auth** — user management (email/password, magic link, OAuth)
- **Storage** — generated images (portraits, environments, scene illustrations)

## 2. PostgreSQL Tables

### users

Managed by Supabase Auth. The `auth.users` table is created automatically. We extend it with a public profile:

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz default now()
);
```

### stories

Top-level entity. One per user idea.

```sql
create table public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idea text not null,
  title text,
  status text not null default 'creating',  -- creating | active | completed
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### characters

Characters generated for a story.

```sql
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  name text not null,
  role text not null,  -- protagonist | antagonist | supporting
  backstory text,
  personality_traits text[],
  physical_description text,
  clothing text,
  distinguishing_features text,
  motivation text,
  portrait_url text,
  created_at timestamptz default now()
);
```

### worlds

World description for a story (one-to-one with stories).

```sql
create table public.worlds (
  id uuid primary key default gen_random_uuid(),
  story_id uuid unique not null references public.stories(id) on delete cascade,
  title text,
  time_period text,
  setting text,
  atmosphere text,
  rules text[],
  cultural_details text,
  created_at timestamptz default now()
);
```

### locations

Key locations within a world.

```sql
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds(id) on delete cascade,
  name text not null,
  description text,
  mood text,
  image_url text,
  created_at timestamptz default now()
);
```

### style_guides

Visual style guide for a story (one-to-one with stories).

```sql
create table public.style_guides (
  id uuid primary key default gen_random_uuid(),
  story_id uuid unique not null references public.stories(id) on delete cascade,
  art_style text,
  color_palette text,
  lighting text,
  mood text,
  reference_notes text,
  created_at timestamptz default now()
);
```

### scenes

Append-only log of scenes per story playthrough.

```sql
create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  scene_number int not null,
  narrative_text text not null,
  scene_image_url text,
  is_ending boolean default false,
  created_at timestamptz default now()
);
```

### choices

Choices presented to the player at each scene.

```sql
create table public.choices (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes(id) on delete cascade,
  choice_text text not null,
  consequence_hint text,  -- internal, not shown to player
  sort_order int default 0
);
```

### sessions

A play session (playthrough). Users can have multiple sessions per story.

```sql
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active',  -- active | paused | completed
  current_scene_id uuid references public.scenes(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### choice_history

Records which choices the user made (append-only event log).

```sql
create table public.choice_history (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  scene_id uuid not null references public.scenes(id),
  choice_id uuid not null references public.choices(id),
  chosen_at timestamptz default now()
);
```

## 3. Entity Relationship Diagram

```
profiles (1) ──── auth.users (1)
                      │
                      │ 1:N
                      ▼
                   stories
                   │  │  │
          ┌────────┘  │  └────────┐
          ▼           ▼           ▼
     characters    worlds    style_guides
                     │
                     ▼
                  locations

   stories (1) ──── (N) sessions
                         │
                         │ 1:N
                         ▼
                       scenes
                         │
                         │ 1:N
                         ▼
                       choices

   sessions ──── choice_history ──── scenes/choices
```

## 4. Supabase Storage

### Buckets

| Bucket | Purpose | Access |
|--------|---------|--------|
| `portraits` | Character portrait images | Public read, authenticated write |
| `environments` | Location and environment images | Public read, authenticated write |
| `scenes` | Scene illustration images | Public read, authenticated write |

### File Naming Convention

```
{bucket}/{story_id}/{type}_{identifier}_{hash}.png
```

Examples:
- `portraits/abc123/character_detective-tanaka_a1b2c3.png`
- `environments/abc123/location_shinjuku-alley_d4e5f6.png`
- `scenes/abc123/scene_001_g7h8i9.png`

## 5. Row-Level Security (RLS)

All tables have RLS enabled. Users can only access their own data.

```sql
-- Stories: users can only see/modify their own stories
alter table public.stories enable row level security;

create policy "Users can view own stories"
  on public.stories for select
  using (auth.uid() = user_id);

create policy "Users can create stories"
  on public.stories for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own stories"
  on public.stories for delete
  using (auth.uid() = user_id);

-- Cascade pattern for child tables (characters, worlds, scenes, etc.)
-- Access is granted if the parent story belongs to the user
create policy "Users can view own characters"
  on public.characters for select
  using (
    exists (
      select 1 from public.stories
      where stories.id = characters.story_id
      and stories.user_id = auth.uid()
    )
  );

-- Same pattern applies to: worlds, locations, style_guides, scenes,
-- choices, sessions, choice_history
```

### Storage Policies

```sql
-- Authenticated users can upload to any bucket
create policy "Authenticated users can upload images"
  on storage.objects for insert
  with check (auth.role() = 'authenticated');

-- Anyone can read images (public URLs for rendering)
create policy "Public read access for images"
  on storage.objects for select
  using (true);
```

## 6. Key Access Patterns

| Query | Used By | Tables |
|-------|---------|--------|
| Get all stories for a user | Story list page | `stories` |
| Get full story state (characters, world, latest scene) | Resume / WebSocket reconnect | `stories` + `characters` + `worlds` + `scenes` + `sessions` |
| Get scene history for a session | Replay / scroll-back | `scenes` + `choices` + `choice_history` |
| Get character portraits for a story | Character display | `characters` (portrait_url column) |
| Append a new scene | Storyteller agent output | `scenes` + `choices` |
| Record a user choice | User makes a choice | `choice_history` + update `sessions.current_scene_id` |
| Get style guide for a story | Visual Director | `style_guides` |

### Indexes

```sql
create index idx_stories_user_id on public.stories(user_id);
create index idx_characters_story_id on public.characters(story_id);
create index idx_scenes_session_id on public.scenes(session_id);
create index idx_scenes_story_id on public.scenes(story_id);
create index idx_choice_history_session_id on public.choice_history(session_id);
create index idx_sessions_story_id on public.sessions(story_id);
```

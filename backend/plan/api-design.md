# API & WebSocket Design

## 1. Overview

The backend exposes two communication channels:
- **REST API** — story management, session CRUD, authentication
- **WebSocket** — real-time narrative streaming during gameplay

## 2. Authentication

Authentication is handled by Supabase Auth. The frontend uses the Supabase JS client to authenticate users (email/password, magic link, or OAuth). The resulting JWT is sent with every request.

```
Authorization: Bearer <supabase_jwt>
```

The FastAPI backend validates the JWT against Supabase's public key on every request.

## 3. REST Endpoints

### Stories

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/stories` | Create a new story from a user idea |
| `GET` | `/api/stories` | List user's stories |
| `GET` | `/api/stories/{story_id}` | Get story details (characters, world, current scene) |
| `DELETE` | `/api/stories/{story_id}` | Delete a story and its associated data |

#### POST /api/stories

Request:
```json
{
  "idea": "A noir detective in 1940s Tokyo discovers that dreams are being stolen by a corporation"
}
```

Response:
```json
{
  "story_id": "uuid",
  "status": "created",
  "websocket_url": "/ws/stories/{story_id}"
}
```

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/stories/{story_id}/sessions` | List play sessions for a story |
| `POST` | `/api/stories/{story_id}/sessions` | Start a new play session |
| `GET` | `/api/stories/{story_id}/sessions/{session_id}` | Get session state (for resume) |

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Backend health check |

## 4. WebSocket Protocol

### Connection

```
ws://localhost:8000/ws/stories/{story_id}
```

The client sends the Supabase JWT as a query parameter or in the first message for authentication.

### Message Types — Server to Client

All messages follow a common envelope:

```json
{
  "type": "<message_type>",
  "data": { ... },
  "timestamp": "2026-05-09T20:00:00Z"
}
```

#### `agent_status`
Indicates which agent is currently working. Lets the frontend show progress.

```json
{
  "type": "agent_status",
  "data": {
    "agent": "character_designer",
    "status": "running",
    "message": "Designing characters..."
  }
}
```

#### `scene`
A complete scene with text, choices, and images.

```json
{
  "type": "scene",
  "data": {
    "scene_id": "uuid",
    "scene_number": 1,
    "text": "The rain hammered the neon signs of Shinjuku...",
    "choices": [
      { "id": "choice_1", "text": "Follow the woman into the alley" },
      { "id": "choice_2", "text": "Head back to the office" },
      { "id": "choice_3", "text": "Call your contact at the precinct" }
    ],
    "images": {
      "scene": "https://supabase.co/storage/v1/...",
      "characters": [
        { "name": "Detective Tanaka", "portrait_url": "https://..." }
      ],
      "environment": "https://supabase.co/storage/v1/..."
    }
  }
}
```

#### `scene_token`
Streaming narrative text token-by-token.

```json
{
  "type": "scene_token",
  "data": {
    "scene_id": "uuid",
    "token": "The "
  }
}
```

#### `image_ready`
Sent when an image finishes generating (may arrive after the scene text).

```json
{
  "type": "image_ready",
  "data": {
    "scene_id": "uuid",
    "image_type": "scene",
    "url": "https://supabase.co/storage/v1/..."
  }
}
```

#### `world_reveal`
Initial world and character data after story creation.

```json
{
  "type": "world_reveal",
  "data": {
    "title": "Stolen Dreams",
    "setting": "1940s Tokyo, rain-soaked noir",
    "characters": [
      {
        "name": "Detective Tanaka",
        "backstory": "...",
        "personality_traits": ["determined", "cynical"],
        "portrait_url": "https://..."
      }
    ],
    "world_description": "...",
    "environment_images": ["https://..."]
  }
}
```

#### `error`
```json
{
  "type": "error",
  "data": {
    "code": "AGENT_FAILURE",
    "message": "The storyteller agent failed to generate a scene. Retrying..."
  }
}
```

#### `story_end`
```json
{
  "type": "story_end",
  "data": {
    "scene_id": "uuid",
    "ending_text": "...",
    "ending_image": "https://..."
  }
}
```

### Message Types — Client to Server

#### `choice`
User selects a narrative choice.

```json
{
  "type": "choice",
  "data": {
    "scene_id": "uuid",
    "choice_id": "choice_1"
  }
}
```

#### `start`
Initiates story generation after WebSocket connection.

```json
{
  "type": "start",
  "data": {
    "idea": "A noir detective in 1940s Tokyo..."
  }
}
```

#### `resume`
Resume a saved session.

```json
{
  "type": "resume",
  "data": {
    "session_id": "uuid"
  }
}
```

## 5. Error Handling

### REST Error Response Format

```json
{
  "error": {
    "code": "STORY_NOT_FOUND",
    "message": "No story found with the given ID"
  }
}
```

### HTTP Status Codes

| Code | Usage |
|------|-------|
| 200 | Success |
| 201 | Resource created |
| 400 | Invalid request body |
| 401 | Missing or invalid JWT |
| 403 | User does not own this resource |
| 404 | Resource not found |
| 500 | Internal server error |

### WebSocket Error Codes

| Code | Description |
|------|-------------|
| `AUTH_FAILED` | JWT validation failed |
| `STORY_NOT_FOUND` | Invalid story ID |
| `AGENT_FAILURE` | An agent failed and retries exhausted |
| `RATE_LIMITED` | Too many requests |
| `INVALID_MESSAGE` | Malformed client message |

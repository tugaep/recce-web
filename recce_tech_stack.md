Tech Stack
Frontend
React 18
Vite 5
TypeScript
React Router
Tailwind CSS
shadcn/ui
Vitest
Backend
Python 3.11
FastAPI
WebSockets
Agent Orchestration
LangGraph
LangSmith
Fal.ai
LangGraph is the backbone of the agent layer. It models the workflow as a state graph where nodes are agents and edges are conditional transitions.
AI Models
Claude Sonnet 4.6
Gpt-image-2
Two models do all the work. Claude Sonnet 4.6 handles every language task. gpt-image-2 handles every image task.
Data Layer
Supabase
Supabase covers three needs in one service: a PostgreSQL database for narrative state and saved sessions, an auth system if we want a login flow for saved stories and an object-storage bucket for generated images.
Deployment
Backend: Local
Frontend: Hostinger
The frontend is built with Vite and deployed as static assets on Hostinger. The backend runs locally during development and during the live demo
Agents
Recce uses two families of agents: story agents that work in language and visual agents that turn descriptions into images. Every language agent uses Claude Sonnet 4.6 and every image-rendering agent uses gpt-image-2.
Story Agents
Agent
Model
Role
Orchestrator
Claude Sonnet 4.6
Reads user input, routes to specialist agents and manages the narrative state graph.
Character Designer
Claude Sonnet 4.6
Generates characters with names, backstories, personalities and physical descriptions.
World Builder
Claude Sonnet 4.6
Designs locations, time period, atmosphere and the rules of the world.
Storyteller
Claude Sonnet 4.6
Writes scenes, dialogue and the branching choices presented to the player.
Judge
Claude Sonnet 4.6
Validates each agent's output for structure, coherence, continuity and safety before it's committed to state.









Visual Agents
Recce's promise is to make the user actually see their movie, the visual layer gets its own specialist team instead of a single image step. 
Agent
Model
Role
Visual Director
Claude Sonnet 4.6
Establishes the project's visual style guide and writes detailed image prompts for the rendering agents.
Character Portrait Artist
gpt-image-2
Renders portraits and full-body shots of each character from the Visual Director's prompts.
World & Environment Artist
gpt-image-2
Renders the key locations of the story; interiors, exteriors, landscapes, establishing shots.
Scene Composer
gpt-image-2
Renders pivotal story moments by combining characters and environments into single dramatic frames.
Visual Continuity Checker
Claude Sonnet 4.6
Reviews each generated image against the style guide and flags inconsistent outputs for regeneration.



How It All Fits Together
A typical run through the system goes: the user types a movie idea on the React frontend, which opens a WebSocket to the FastAPI backend. The backend hands the idea to the LangGraph orchestrator, which calls Claude Sonnet 4.6 through the Character Designer and World Builder in parallel. Those outputs go to the Visual Director, which writes prompts for the Character Portrait Artist and World & Environment Artist; both call gpt-image-2 and the resulting images are uploaded to Supabase storage. The Storyteller then writes the opening scene, the Scene Composer renders an illustration for it, the Judge and Visual Continuity Checker validate everything,and the scene plus its choices stream back over the WebSocket to the frontend. When the user makes a choice, that choice updates LangGraph's narrative state and the loop runs again.

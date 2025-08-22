# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is a Tauri desktop application with a Vue 3 + TypeScript frontend that implements an AI agent system with multi-model support and conversation management.

## Core Technologies

- **Frontend**: Vue 3 with Composition API, TypeScript, Vite
- **Desktop Framework**: Tauri v2
- **State Management**: Pinia with persistence
- **UI Library**: Naive UI
- **Database**: SQLite (via Tauri SQL plugin)
- **AI SDKs**: OpenAI, Anthropic, Google Gemini, Groq, Ollama, LangChain

## Development Commands

```bash
# Install dependencies (using pnpm)
pnpm install

# Run development server
pnpm dev

# Run Tauri development mode
pnpm tauri dev

# Build for production
pnpm build

# Build Tauri application
pnpm tauri build

# Type checking
vue-tsc --noEmit

# Preview production build
pnpm preview
```

## Architecture Overview

### Frontend Structure (`src/`)

- **`App.vue`**: Main application component managing conversations, messages, and UI state
- **`main.ts`**: Application entry point, initializes Vue, Pinia, and studio event listeners

### Key Components

- **`components/`**: Reusable Vue components
  - `StudioPane.vue`: Agent studio interface
  - `MarkdownRenderer.vue`: Markdown content rendering
  - `ModelDialog.vue`: Model configuration UI
  - `MCPToolsManager.vue`: MCP tools management
  - `PlanStepsPanel.vue`: Task planning visualization

### Services Layer (`src/services/`)

- **`database.ts`**: SQLite database operations for conversations, messages, and settings
- **`conversationStream.ts`**: Handles streaming conversation responses from agents
- **`studioBus.ts`**: Event bus for studio communication between windows
- **`cacheManager.ts`**: Manages conversation content caching
- **`windowControl.ts`**: Tauri window control operations

### State Management (`src/stores/`)

- **`chatStore.ts`**: Conversation and message state (currently unused in favor of direct database access)
- **`modelStore.ts`**: AI model configurations and selection
- **`mcpStore.ts`**: MCP (Model Context Protocol) server management
- **`settingsStore.ts`**: Application settings with persistence

### Agent System (`src/apps/agent/`)

- **`conversation-agent-manager.ts`**: Singleton managing agent contexts per conversation
- **`conversion-actor-agent.ts`**: Main agent implementation handling conversations
- **`coordinate-role-play.ts`**: Multi-agent coordination system
- **`base-agent.ts`**: Base agent class with common functionality
- **`dialogue-agent.ts`**: Dialogue-specific agent implementation

### Toolkits (`src/apps/toolkits/`)

Modular toolkit system for agent capabilities:
- **`browser-user-toolkit/`**: Browser automation tools
- **`chart-toolkit/`**: Chart generation and analysis
- **`code-toolkit/`**: Code generation and execution
- **`document-toolkit/`**: Document processing (PDF, Word, Excel, PowerPoint)
- **`file-toolkit/`**: File system operations

### Tauri Backend (`src-tauri/`)

- **`src/lib.rs`**: Main Rust entry point with database migrations and window commands
- **`tauri.conf.json`**: Tauri configuration for build and runtime settings
- **`Cargo.toml`**: Rust dependencies including Tauri plugins

## Database Schema

The application uses SQLite with the following tables:
- `conversations`: Stores conversation metadata
- `messages`: Stores individual messages within conversations
- `settings`: Key-value store for application settings
- `model_configs`: AI model configurations
- `plan_status`: Task planning status tracking
- `step_status`: Individual step status within plans

## Key Patterns

### Agent Communication
- Agents communicate through RxJS observables for streaming responses
- Each conversation has its own agent context managed by `ConversationAgentManager`
- Studio events are bridged between windows using Tauri's event system

### State Management
- Pinia stores handle global state with persistence
- Direct database access is preferred for conversation data
- Token usage is tracked per message and aggregated per session

### UI Architecture
- Custom window controls (frameless window with transparent background)
- Collapsible sidebar for conversation list
- Real-time streaming message updates with content blocks
- Support for code blocks, markdown, URL carousels, and plan steps

## Important Configurations

### Vite Configuration (`vite.config.ts`)
- Port 1420 for development server
- Node.js polyfills configured for Tauri environment
- Optimized dependencies for large libraries

### TypeScript Configuration (`tsconfig.json`)
- Strict mode enabled
- ES2020 target with ESNext modules
- Vue JSX support

### Window Configuration
- Frameless window with custom decorations
- Transparent background enabled
- Default size: 1200x800px

## Development Notes

- The application uses a custom window titlebar implementation
- Message content is parsed into blocks for different content types
- Agent responses stream in real-time with support for cancellation
- Multiple AI models can be configured and switched dynamically
- The studio pane provides visual feedback for agent actions

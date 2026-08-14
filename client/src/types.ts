// Types mirror the backend API contract exactly (server on :3100).

export type Sport = 'All' | 'MLB' | 'NFL' | 'NBA';

export type Role = 'user' | 'assistant';

export interface ToolEvent {
  name: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
}

export interface SgpLeg {
  sport?: string;
  game?: string;
  selection?: string;
  market?: string;
  line?: string | number | null;
  odds?: number | null;
  justification?: string;
  risk?: string;
  correlation?: string;
  confidence?: number;
  game_odds?: string | null; // real game moneyline (ESPN → DraftKings), e.g. "-141"
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  tools?: ToolEvent[];
  sgp?: SgpLeg[];
  error?: string;
  streaming?: boolean;
}

/** SSE event frames from POST /api/chat — discriminated on `type`. */
export type ChatEvent =
  | { type: 'meta'; model?: string; sport?: string | null; llmConfigured?: boolean }
  | { type: 'tool'; name: string; status: ToolEvent['status']; summary?: string }
  | { type: 'delta'; text: string }
  | { type: 'sgp'; legs: SgpLeg[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type HealthState = 'checking' | 'ok' | 'down';

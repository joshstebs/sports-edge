// Types mirror the backend API contract exactly (server on :3100).

export type Sport = 'All' | 'MLB' | 'NFL' | 'NBA' | 'NHL' | 'NCAAF' | 'NCAAB' | 'WNBA' | 'UFC' | 'SOCCER';

// League scope exposed in the nav. 'All' scopes the analyst to every sport.
// Sports the engine can currently grade/predict are marked live (status).
export interface SportMeta {
  code: Sport;
  label: string;
  status: 'live' | 'planned';
}

export const SPORTS: readonly SportMeta[] = [
  { code: 'All', label: 'All', status: 'live' },
  { code: 'MLB', label: 'MLB', status: 'live' },
  { code: 'NFL', label: 'NFL', status: 'live' },
  { code: 'NBA', label: 'NBA', status: 'live' },
  { code: 'NHL', label: 'NHL', status: 'live' },
  { code: 'NCAAF', label: 'NCAAF', status: 'planned' },
  { code: 'NCAAB', label: 'NCAAB', status: 'planned' },
  { code: 'WNBA', label: 'WNBA', status: 'planned' },
  { code: 'UFC', label: 'UFC', status: 'planned' },
  { code: 'SOCCER', label: 'Soccer', status: 'planned' },
];

export function sportLabel(code: Sport): string {
  return SPORTS.find((s) => s.code === code)?.label ?? code;
}

export type Role = 'user' | 'assistant';

export interface ToolEvent {
  name: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
}

export interface SgpLeg {
  sport?: string;
  game?: string;
  eventDate?: string;
  eventId?: string;
  entity_type?: string;
  player_name?: string;
  player_id?: string;
  team?: string;
  selection?: string;
  market?: string;
  side?: string;
  line?: string | number | null;
  odds?: number | null;
  justification?: string;
  risk?: string;
  correlation?: string;
  confidence?: number;
  game_odds?: string | null; // real game moneyline (ESPN → DraftKings), e.g. "-141"
  model_probability?: string | number;
  model_version?: string;
  model_sample_size?: number;
  model_source?: string;
  __gateNote?: string;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  images?: string[]; // attached screenshot data URLs (resized client-side)
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
  | { type: 'log'; stored?: number; failed?: number; error?: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type HealthState = 'checking' | 'ok' | 'down';

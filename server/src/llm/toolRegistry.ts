// Tool registry: name -> {schema, handler}. executeTool never throws and
// returns a JSON string the LLM can consume as the tool result.

import { TOOL_DEFS, ToolDef, ToolOutcome } from './tools.js';
import { MLB_PROVISIONAL_TOOL } from './mlbProvisionalTool.js';
import type { ToolSchema } from './chatClient.js';

const ALL_TOOL_DEFS: ToolDef[] = [...TOOL_DEFS, MLB_PROVISIONAL_TOOL];
const registry = new Map<string, ToolDef>();
for (const def of ALL_TOOL_DEFS) registry.set(def.name, def);

/** OpenAI-style tools array for the chat completions API. */
export function getToolSchemas(): ToolSchema[] {
  return ALL_TOOL_DEFS.map((d) => ({
    type: 'function',
    function: { name: d.name, description: d.description, parameters: d.parameters },
  }));
}

export interface ToolExecution {
  ok: boolean;
  summary: string;
  data: any;
  json: string;
}

/** Execute a tool by name; ALWAYS resolves (never throws). */
export async function executeTool(name: string, args: any): Promise<ToolExecution> {
  const def = registry.get(name);
  if (!def) {
    const json = JSON.stringify({ available: false, reason: `unknown tool "${name}"` });
    return { ok: false, summary: `unknown tool ${name}`, data: null, json };
  }
  try {
    const outcome: ToolOutcome = await def.handler(args ?? {});
    return {
      ok: outcome.available,
      summary: outcome.summary,
      data: outcome.data,
      json: JSON.stringify(outcome.payload),
    };
  } catch (e) {
    const json = JSON.stringify({ available: false, reason: `tool crashed: ${(e as Error).message}` });
    return { ok: false, summary: `${name} crashed: ${(e as Error).message}`, data: null, json };
  }
}

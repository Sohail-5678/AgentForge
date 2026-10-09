/** Display metadata shared by server and client components. */

export const AGENT_META: Record<string, { name: string; short: string; tagline: string; color: string; repo?: string }> = {
  datapilot: {
    name: "DataPilot",
    short: "DP",
    tagline: "Multi-agent text-to-SQL analyst",
    color: "var(--info)",
    repo: "https://github.com/Sohail-5678/Datapilot-Multi-Agent-Data-Analyst",
  },
  returnpilot: {
    name: "ReturnPilot",
    short: "RP",
    tagline: "Returns agent with human approval",
    color: "var(--accent)",
    repo: "https://github.com/Sohail-5678/returnpilot",
  },
  toy: { name: "Toy agent", short: "TY", tagline: "Bundled target for AgentForge's own CI", color: "var(--violet)" },
};

export function agentName(id: string | null | undefined) {
  if (!id) return "—";
  return AGENT_META[id]?.name ?? id;
}

/** OWASP Top 10 for LLM Applications (2025) mapping, SPEC §8.2. */
export const CATEGORIES: { id: string; label: string; owasp: string }[] = [
  { id: "direct_injection", label: "Direct injection", owasp: "LLM01" },
  { id: "indirect_injection", label: "Indirect injection", owasp: "LLM01" },
  { id: "data_exfiltration", label: "Data exfiltration", owasp: "LLM02" },
  { id: "system_prompt_extraction", label: "Prompt extraction", owasp: "LLM07" },
  { id: "excessive_agency", label: "Excessive agency", owasp: "LLM06" },
  { id: "unsafe_sql", label: "Unsafe SQL", owasp: "LLM05" },
  { id: "tool_arg_injection", label: "Tool-arg injection", owasp: "LLM05" },
  { id: "unbounded_consumption", label: "Unbounded consumption", owasp: "LLM10" },
  { id: "misinformation", label: "Misinformation", owasp: "LLM09" },
  { id: "off_policy_content", label: "Off-policy content", owasp: "—" },
];

/** Defence layers in pipeline order (§8.6) with chart colours. */
export const LAYERS: { id: string; label: string; color: string }[] = [
  { id: "input_guard", label: "Input guard", color: "#f32e35" },
  { id: "policy_engine", label: "Policy engine", color: "#ff7a59" },
  { id: "tool_permission", label: "Tool permission", color: "#f5b544" },
  { id: "approval_gate", label: "Approval gate", color: "#4fd1a1" },
  { id: "sql_guard", label: "SQL guard", color: "#8ab4ff" },
  { id: "output_guard", label: "Output guard", color: "#b9a2ff" },
  { id: "model_refusal", label: "Model refusal", color: "#c9c3bb" },
  { id: "ineffective", label: "Ineffective", color: "#5c5760" },
];

export const TRIGGER_LABEL: Record<string, string> = {
  nightly: "Nightly",
  manual: "Manual",
  pr: "PR gate",
  optimizer: "Optimizer",
  gate: "Promotion gate",
};

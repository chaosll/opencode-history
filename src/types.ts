export interface SessionRow {
  id: string;
  slug: string | null;
  title: string | null;
  projectId: string | null;
  directory: string | null;
  path: string | null;
  agent: string | null;
  model: string | null;
  cost: number;
  tokensInput: number;
  tokensOutput: number;
  tokensReasoning: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  createdAt: number;
  updatedAt: number;
}

export interface ModelInfo {
  id?: string;
  providerID?: string;
  variant?: string;
}

export interface SessionTokens {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface SessionInfo {
  id: string;
  slug?: string;
  projectID?: string;
  directory?: string;
  path?: string;
  title?: string;
  agent?: string;
  model?: ModelInfo;
  version?: string;
  summary?: { additions?: number; deletions?: number; files?: number };
  cost?: number;
  tokens?: SessionTokens;
  time?: { created: number; updated: number };
}

export interface MessageInfo {
  id?: string;
  role?: string;
  messageID?: string;
  time?: { created?: number; completed?: number };
  model?: ModelInfo;
  agent?: string;
}

export interface Part {
  type: string;
  [key: string]: unknown;
}

export interface SessionMessage {
  info?: MessageInfo;
  parts?: Part[];
}

export interface SessionExport {
  info: SessionInfo;
  messages: SessionMessage[];
}

export interface StatsOverview {
  sessions: number;
  tokensInput: number;
  tokensOutput: number;
  tokensReasoning: number;
  cost: number;
}

export interface ProjectStat {
  projectId: string | null;
  directory: string | null;
  sessions: number;
  tokens: number;
  cost: number;
}

export interface DayStat {
  day: string;
  sessions: number;
  tokens: number;
  cost: number;
}

export interface ModelStat {
  model: string | null;
  sessions: number;
  tokens: number;
  cost: number;
}

export interface Stats {
  overview: StatsOverview;
  byProject: ProjectStat[];
  byDay: DayStat[];
  byModel: ModelStat[];
}
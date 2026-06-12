export interface JobRequest {
  repoUrl: string;
  branch?: string;
  prompt: string;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  images?: ImageAttachment[];
  additionalFiles?: string[];
  webhookUrl?: string;
  timeoutMs?: number;
  memoryLimit?: string;
  cpuLimit?: string;
  networkAccess?: string;
  envVars?: Record<string, string>;
}

export interface ImageAttachment {
  filename: string;
  data: string; // base64
  mediaType: string;
}

export type JobStatus =
  | 'pending'
  | 'cloning'
  | 'detecting_language'
  | 'generating_docker'
  | 'building_image'
  | 'ready'
  | 'running'
  | 'creating_pr'
  | 'completed'
  | 'failed';

export interface JobResponse {
  id: string;
  repoUrl: string;
  branch?: string;
  prompt: string;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  status: JobStatus;
  prUrl?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ServerConfig {
  port: number;
  host: string;
  apiKey?: string;
  githubToken?: string;
  maxConcurrentJobs: number;
  defaultTimeoutMinutes: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface JobDetails {
  id: string;
  repoUrl: string;
  branch?: string;
  prompt: string;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  status: JobStatus;
  prUrl?: string;
  errorMessage?: string;
  errorType?: string;
  errorPrUrl?: string;
  retryCount?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  startedAt?: number;
  language?: string;
  dockerImage?: string;
  prBranch?: string;
  prTitle?: string;
  prDescription?: string;
  prAuthor?: string;
}

export interface JobStats {
  total: number;
  byStatus: { status: string; count: number }[];
  avgDuration: number | null;
  successRate: number;
}

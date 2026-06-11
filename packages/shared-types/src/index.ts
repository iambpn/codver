export interface JobRequest {
  repoUrl: string;
  branch?: string;
  prompt: string;
  model?: string;
}

export type JobStatus = 'pending' | 'cloning' | 'ready' | 'running' | 'completed' | 'failed';

export interface JobResponse {
  id: string;
  repoUrl: string;
  branch?: string;
  prompt: string;
  model?: string;
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

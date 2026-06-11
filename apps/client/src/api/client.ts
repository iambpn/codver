import { readConfig } from '../config/store';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export class ApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    const config = readConfig();
    if (!config.serverUrl) {
      throw new Error('Server URL not configured. Run: codver config set-server <url>');
    }
    if (!config.apiKey) {
      throw new Error('API key not configured. Run: codver config set-key <key>');
    }
    this.baseUrl = config.serverUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  async get<T>(path: string): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });
    return this.parseResponse<T>(res);
  }

  async post<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return this.parseResponse<T>(res);
  }

  private async parseResponse<T>(res: Response): Promise<ApiResponse<T>> {
    const text = await res.text();
    let json: Record<string, unknown> | undefined;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // not JSON
    }

    if (!res.ok) {
      return {
        success: false,
        error: (json?.error as string) || `HTTP ${res.status}: ${res.statusText}`,
        code: json?.code as string | undefined,
      };
    }

    // If the server returns an ApiResponse wrapper, unwrap it
    if (json && 'success' in json) {
      return json as unknown as ApiResponse<T>;
    }

    // Otherwise, treat the entire JSON as the raw data
    return { success: true, data: json as T };
  }
}

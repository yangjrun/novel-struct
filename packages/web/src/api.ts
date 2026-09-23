import type {
  ApiResponse,
  BookDto,
  ChapterDetailDto,
  ConfigDto,
  DeleteBookResultDto,
  EditionDetailDto,
  EntityDto,
  EntityReviewDto,
  ImportResultDto,
  JobDto,
  ParseRequestDto,
  SceneSearchResultDto,
  TimelineEventDto,
  TtsTaskDto,
  VoiceProfileDto,
  UsageReportDto,
} from '@novelstruct/api/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = '/api';
const TOKEN_KEY = 'novelstruct-api-token';
export const storedToken = sessionStorage.getItem(TOKEN_KEY) ?? '';

export function setApiToken(value: string): void {
  sessionStorage.setItem(TOKEN_KEY, value.trim());
}

function authHeaders(): Headers {
  const headers = new Headers();
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    authHeaders().forEach((value, key) => headers.set(key, value));
    response = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch (error) {
    throw new ApiError(0, `无法连接到 API：${error instanceof Error ? error.message : String(error)}`);
  }
  let body: ApiResponse<T>;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(response.status, `API 返回了非 JSON 响应（HTTP ${response.status}）`);
  }
  if (!body.success) throw new ApiError(response.status, body.error);
  return body.data;
}

function postJson<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export interface ImportInput {
  readonly file: File;
  /** Empty means "use the file's own metadata", which only an EPUB has. */
  readonly title?: string;
  readonly author?: string;
  readonly label?: string;
}

export const api = {
  config: () => request<ConfigDto>('/config'),
  books: () => request<BookDto[]>('/books'),
  importBook: (input: ImportInput) => {
    const form = new FormData();
    form.set('file', input.file);
    if (input.title) form.set('title', input.title);
    if (input.author) form.set('author', input.author);
    if (input.label) form.set('label', input.label);
    return request<ImportResultDto>('/books/import', { method: 'POST', body: form });
  },
  deleteBook: (bookId: string) =>
    request<DeleteBookResultDto>(`/books/${encodeURIComponent(bookId)}`, { method: 'DELETE' }),
  edition: (editionId: string) => request<EditionDetailDto>(`/editions/${encodeURIComponent(editionId)}`),
  chapter: (editionId: string, index: number) =>
    request<ChapterDetailDto>(`/editions/${encodeURIComponent(editionId)}/chapters/${index}`),
  ttsTasks: (editionId: string, index: number) =>
    request<TtsTaskDto[]>(`/editions/${encodeURIComponent(editionId)}/chapters/${index}/tts`),
  voiceProfiles: (bookId: string) => request<VoiceProfileDto[]>(`/books/${encodeURIComponent(bookId)}/voices`),
  setVoiceProfile: (bookId: string, entityId: string, provider: string, voiceId: string) =>
    request<{ entityId: string }>(`/books/${encodeURIComponent(bookId)}/voices/${encodeURIComponent(entityId)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, voiceId }),
    }),
  entities: (editionId: string) => request<EntityDto[]>(`/editions/${encodeURIComponent(editionId)}/entities`),
  timeline: (editionId: string) => request<TimelineEventDto[]>(`/editions/${encodeURIComponent(editionId)}/timeline`),
  reviews: (bookId: string) => request<EntityReviewDto[]>(`/books/${encodeURIComponent(bookId)}/reviews`),
  finishReview: (bookId: string, id: string, status: 'approved' | 'rejected') =>
    postJson<{ id: string; status: string }>(`/books/${encodeURIComponent(bookId)}/reviews/${encodeURIComponent(id)}`, {
      status,
    }),
  reportUrl: (editionId: string) => `${BASE}/editions/${encodeURIComponent(editionId)}/report`,
  startParse: (editionId: string, body: ParseRequestDto) =>
    postJson<JobDto>(`/editions/${encodeURIComponent(editionId)}/parse`, body),
  jobs: () => request<JobDto[]>('/jobs'),
  job: (jobId: string) => request<JobDto>(`/jobs/${encodeURIComponent(jobId)}`),
  cancelJob: (jobId: string) => request<JobDto>(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }),
  usage: () => request<UsageReportDto>('/usage'),
  editionUsage: (editionId: string) => request<UsageReportDto>(`/editions/${encodeURIComponent(editionId)}/usage`),
  search: (query: string, bookIds: string[]) => postJson<SceneSearchResultDto[]>('/search', { query, bookIds }),
  indexEdition: (editionId: string) =>
    request<{ indexed: number; pending: number }>(`/search/editions/${encodeURIComponent(editionId)}/index`, {
      method: 'POST',
    }),
  openReport: async (editionId: string) => {
    const response = await fetch(`${BASE}/editions/${encodeURIComponent(editionId)}/report`, {
      headers: authHeaders(),
    });
    if (!response.ok) throw new ApiError(response.status, `报告加载失败（HTTP ${response.status}）`);
    const url = URL.createObjectURL(await response.blob());
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

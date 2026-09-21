import type {
  ApiResponse,
  BookDto,
  ChapterDetailDto,
  ConfigDto,
  EditionDetailDto,
  EntityDto,
  ImportResultDto,
  JobDto,
  ParseRequestDto,
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
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
  edition: (editionId: string) => request<EditionDetailDto>(`/editions/${encodeURIComponent(editionId)}`),
  chapter: (editionId: string, index: number) =>
    request<ChapterDetailDto>(`/editions/${encodeURIComponent(editionId)}/chapters/${index}`),
  entities: (editionId: string) => request<EntityDto[]>(`/editions/${encodeURIComponent(editionId)}/entities`),
  reportUrl: (editionId: string) => `${BASE}/editions/${encodeURIComponent(editionId)}/report`,
  startParse: (editionId: string, body: ParseRequestDto) =>
    postJson<JobDto>(`/editions/${encodeURIComponent(editionId)}/parse`, body),
  jobs: () => request<JobDto[]>('/jobs'),
  job: (jobId: string) => request<JobDto>(`/jobs/${encodeURIComponent(jobId)}`),
  cancelJob: (jobId: string) => request<JobDto>(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

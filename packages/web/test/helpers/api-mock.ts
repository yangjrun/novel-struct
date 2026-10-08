import { vi } from 'vitest';
import type { api as realApi } from '../../src/api.js';

export const api = {
  config: vi.fn<typeof realApi.config>(),
  edition: vi.fn<typeof realApi.edition>(),
  editionUsage: vi.fn<typeof realApi.editionUsage>(),
  jobs: vi.fn<typeof realApi.jobs>(),
  entities: vi.fn<typeof realApi.entities>(),
  voiceProfiles: vi.fn<typeof realApi.voiceProfiles>(),
  setVoiceProfile: vi.fn<typeof realApi.setVoiceProfile>(),
  chapter: vi.fn<typeof realApi.chapter>(),
  timeline: vi.fn<typeof realApi.timeline>(),
  reviews: vi.fn<typeof realApi.reviews>(),
  indexEdition: vi.fn<typeof realApi.indexEdition>(),
  openReport: vi.fn<typeof realApi.openReport>(),
};

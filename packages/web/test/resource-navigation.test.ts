import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import type {
  ChapterDetailDto,
  EditionDetailDto,
  EntityDto,
  EntityReviewDto,
  TimelineEventDto,
} from '@novelstruct/api/contracts';
import App from '../src/App.vue';
import ChapterPage from '../src/pages/ChapterPage.vue';
import EditionPage from '../src/pages/EditionPage.vue';
import EntitiesPage from '../src/pages/EntitiesPage.vue';
import ReviewsPage from '../src/pages/ReviewsPage.vue';
import TimelinePage from '../src/pages/TimelinePage.vue';
import { api } from './helpers/api-mock.js';
import { deferred, editionStubs } from './helpers/component.js';
import {
  chapterFixture,
  configFixture,
  editionFixture,
  entityFixture,
  reviewFixture,
  timelineFixture,
  usageFixture,
} from './helpers/fixtures.js';

vi.mock('../src/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api.js')>()),
  api: (await import('./helpers/api-mock.js')).api,
}));

enableAutoUnmount(afterEach);
afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

async function mountApp(path: string) {
  const placeholder = { template: '<div />' };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'library', component: placeholder },
      { path: '/jobs', name: 'jobs', component: placeholder },
      { path: '/usage', name: 'usage', component: placeholder },
      { path: '/search', name: 'search', component: placeholder },
      { path: '/editions/:editionId', name: 'edition', component: EditionPage, props: true },
      { path: '/editions/:editionId/entities', name: 'entities', component: EntitiesPage, props: true },
      { path: '/editions/:editionId/entities-alt', name: 'entities-alt', component: EntitiesPage, props: true },
      { path: '/editions/:editionId/timeline', name: 'timeline', component: TimelinePage, props: true },
      { path: '/books/:bookId/reviews', name: 'reviews', component: ReviewsPage, props: true },
      {
        path: '/editions/:editionId/chapters/:index',
        name: 'chapter',
        component: ChapterPage,
        props: (route) => ({ editionId: route.params['editionId'], index: Number(route.params['index']) }),
      },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [router], stubs: editionStubs } });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  api.config.mockResolvedValue(configFixture());
  api.edition.mockImplementation(async (id) => editionFixture(id, `book-for-${id}`));
  api.editionUsage.mockResolvedValue(usageFixture());
  api.jobs.mockResolvedValue([]);
  api.entities.mockImplementation(async (id) => [entityFixture(`Entity ${id}`)]);
  api.voiceProfiles.mockResolvedValue([]);
  api.chapter.mockImplementation(async (id, index) => chapterFixture(id, index));
  api.timeline.mockImplementation(async (id) => [timelineFixture(id)]);
  api.reviews.mockImplementation(async (id) => [reviewFixture(id)]);
});

const resourceCases = [
  {
    name: 'edition ID',
    from: '/editions/edition-a',
    to: '/editions/edition-b',
    oldText: 'Book edition-a',
    calls: () => api.edition.mock.calls.length,
    holdNext: () => {
      const pending = deferred<EditionDetailDto>();
      api.edition.mockReturnValueOnce(pending.promise);
      return () => pending.reject(new Error('B 加载失败'));
    },
  },
  {
    name: 'entities edition ID',
    from: '/editions/edition-a/entities',
    to: '/editions/edition-b/entities',
    oldText: 'Entity edition-a',
    calls: () => api.entities.mock.calls.length,
    holdNext: () => {
      const pending = deferred<EntityDto[]>();
      api.entities.mockReturnValueOnce(pending.promise);
      return () => pending.reject(new Error('B 加载失败'));
    },
  },
  {
    name: 'timeline edition ID',
    from: '/editions/edition-a/timeline',
    to: '/editions/edition-b/timeline',
    oldText: 'Event edition-a',
    calls: () => api.timeline.mock.calls.length,
    holdNext: () => {
      const pending = deferred<TimelineEventDto[]>();
      api.timeline.mockReturnValueOnce(pending.promise);
      return () => pending.reject(new Error('B 加载失败'));
    },
  },
  {
    name: 'reviews book ID',
    from: '/books/book-a/reviews',
    to: '/books/book-b/reviews',
    oldText: 'Review book-a',
    calls: () => api.reviews.mock.calls.length,
    holdNext: () => {
      const pending = deferred<EntityReviewDto[]>();
      api.reviews.mockReturnValueOnce(pending.promise);
      return () => pending.reject(new Error('B 加载失败'));
    },
  },
  {
    name: 'chapter index',
    from: '/editions/edition-a/chapters/1',
    to: '/editions/edition-a/chapters/2',
    oldText: 'Chapter edition-a-1',
    calls: () => api.chapter.mock.calls.length,
    holdNext: () => {
      const pending = deferred<ChapterDetailDto>();
      api.chapter.mockReturnValueOnce(pending.promise);
      return () => pending.reject(new Error('B 加载失败'));
    },
  },
  {
    name: 'chapter edition ID',
    from: '/editions/edition-a/chapters/1',
    to: '/editions/edition-b/chapters/1',
    oldText: 'Chapter edition-a-1',
    calls: () => api.chapter.mock.calls.length,
    holdNext: () => {
      const pending = deferred<ChapterDetailDto>();
      api.chapter.mockReturnValueOnce(pending.promise);
      return () => pending.reject(new Error('B 加载失败'));
    },
  },
];

describe('App resource navigation', () => {
  it('recovers the connection using the token form before mounting a resource', async () => {
    api.config.mockRejectedValueOnce(new Error('需要访问令牌'));
    const { wrapper } = await mountApp('/editions/edition-a');
    expect(wrapper.text()).toContain('需要访问令牌');
    expect(api.edition).not.toHaveBeenCalled();
    api.config.mockResolvedValue({ ...configFixture(), queue: 'bullmq', llmConfigured: true, llmModel: 'test-model' });
    await wrapper.get('input[type="password"]').setValue('test-only-token');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.config).toHaveBeenCalledTimes(3);
    expect(wrapper.text()).toContain('Book edition-a');
    expect(wrapper.text()).toContain('BullMQ');
    expect(wrapper.text()).toContain('test-model');
    expect(wrapper.find('input[type="password"]').exists()).toBe(false);
  });

  it.each(resourceCases)('remounts on $name and never displays A while B is slow or fails', async (scenario) => {
    const { wrapper, router } = await mountApp(scenario.from);
    expect(wrapper.text()).toContain(scenario.oldText);
    expect(scenario.calls()).toBe(1);
    const failNext = scenario.holdNext();
    await router.push(scenario.to);
    await flushPromises();

    expect(scenario.calls()).toBe(2);
    expect(wrapper.text()).not.toContain(scenario.oldText);
    failNext();
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('B 加载失败');
    expect(wrapper.text()).not.toContain(scenario.oldText);
  });

  it('keeps the chapter instance and fetched data when only raw, offset, or hash changes', async () => {
    const { wrapper, router } = await mountApp('/editions/edition-a/chapters/1');
    const originalPage = wrapper.getComponent(ChapterPage).vm.$.uid;
    await router.push('/editions/edition-a/chapters/1?raw=1&offset=1');
    await flushPromises();
    expect(wrapper.getComponent(ChapterPage).vm.$.uid === originalPage).toBe(true);
    expect(wrapper.get('#source-target').text()).toBe('第一行原文');
    await router.push('/editions/edition-a/chapters/1?raw=1&offset=7#source-target');
    await flushPromises();

    expect(wrapper.getComponent(ChapterPage).vm.$.uid === originalPage).toBe(true);
    expect(wrapper.get('#source-target').text()).toBe('第二行原文');
    expect(api.chapter).toHaveBeenCalledExactlyOnceWith('edition-a', 1);
  });

  it('includes the route name in the key but excludes query-only changes', async () => {
    const { wrapper, router } = await mountApp('/editions/edition-a/entities');
    const originalPage = wrapper.getComponent(EntitiesPage).vm.$.uid;
    await wrapper.get('input[placeholder="名字或别名"]').setValue('保留筛选');
    await router.push('/editions/edition-a/entities?view=compact#entities');
    await flushPromises();
    expect(wrapper.getComponent(EntitiesPage).vm.$.uid === originalPage).toBe(true);
    expect(wrapper.get<HTMLInputElement>('input[placeholder="名字或别名"]').element.value).toBe('保留筛选');
    expect(api.entities).toHaveBeenCalledTimes(1);

    await router.push('/editions/edition-a/entities-alt');
    await flushPromises();
    expect(wrapper.getComponent(EntitiesPage).vm.$.uid === originalPage).toBe(false);
    expect(api.entities).toHaveBeenCalledTimes(2);
    expect(wrapper.get<HTMLInputElement>('input[placeholder="名字或别名"]').element.value).toBe('');
  });

  it('starts exactly one edition and voices request per entities resource', async () => {
    const { wrapper, router } = await mountApp('/editions/edition-a/entities');
    await router.push('/editions/edition-b/entities');
    await flushPromises();

    expect(api.edition.mock.calls).toEqual([['edition-a'], ['edition-b']]);
    expect(api.entities.mock.calls).toEqual([['edition-a'], ['edition-b']]);
    expect(api.voiceProfiles.mock.calls).toEqual([['book-for-edition-a'], ['book-for-edition-b']]);
    expect(wrapper.text()).toContain('Entity edition-b');
    expect(wrapper.text()).not.toContain('Entity edition-a');
  });
});

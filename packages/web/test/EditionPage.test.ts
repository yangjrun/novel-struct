import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import type { EditionDetailDto, JobDto, UsageReportDto } from '@novelstruct/api/contracts';
import EditionPage from '../src/pages/EditionPage.vue';
import { api } from './helpers/api-mock.js';
import { button, deferred, editionStubs, JobCardStub, ParseFormStub } from './helpers/component.js';
import { configFixture, editionFixture, jobFixture, parseRunFixture, usageFixture } from './helpers/fixtures.js';

vi.mock('../src/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api.js')>()),
  api: (await import('./helpers/api-mock.js')).api,
}));

enableAutoUnmount(afterEach);
afterEach(() => vi.useRealTimers());

function mountPage() {
  return mount(EditionPage, {
    props: { editionId: 'edition-a' },
    global: { stubs: { ...editionStubs, RouterLink: RouterLinkStub } },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  api.config.mockResolvedValue(configFixture());
  api.edition.mockResolvedValue(editionFixture());
  api.editionUsage.mockResolvedValue(usageFixture());
  api.jobs.mockResolvedValue([]);
});

describe('EditionPage coordinated refresh', () => {
  it('preserves chapter filters and counts after refreshing resources', async () => {
    const edition = editionFixture();
    const chapter = edition.chapters[0]!;
    api.edition.mockResolvedValue({
      ...edition,
      chapters: [
        { ...chapter, title: '完成章', segmentCount: 3, latestRun: parseRunFixture() },
        { ...chapter, id: 'chapter-2', index: 2, number: null, title: '待解析章' },
        {
          ...chapter,
          id: 'chapter-3',
          index: 3,
          number: 3,
          title: null,
          latestRun: parseRunFixture({ status: 'failed', model: 'test-model' }),
        },
      ],
    });
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('tbody tr')).toHaveLength(3);
    await wrapper.get('select').setValue('parsed');
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    expect(wrapper.get('tbody').text()).toContain('完成章');
    await wrapper.get('select').setValue('unparsed');
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
    await wrapper.get('select').setValue('failed');
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    expect(wrapper.get('tbody').text()).toContain('第 3 章');
    expect(wrapper.get('tbody').text()).toContain('test-model');
    await wrapper.get('select').setValue('all');
    await button(wrapper, '刷新').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('tbody tr')).toHaveLength(3);
  });

  it('renders an empty edition without invalid progress or a chapter table', async () => {
    api.edition.mockResolvedValue({ ...editionFixture(), chapters: [] });
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('没有符合条件的章节');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.get('.meter span').attributes('style')).toContain('width: 0%');
    expect(button(wrapper, '索引场景').element.disabled).toBe(true);
  });

  it('keeps index progress visible and restores the action after completion or failure', async () => {
    api.config.mockResolvedValue({ ...configFixture(), embeddingConfigured: true });
    const indexing = deferred<{ indexed: number; pending: number }>();
    api.indexEdition.mockReturnValueOnce(indexing.promise);
    const wrapper = mountPage();
    await flushPromises();
    await button(wrapper, '索引场景').trigger('click');
    expect(button(wrapper, '索引中…').element.disabled).toBe(true);
    indexing.resolve({ indexed: 3, pending: 2 });
    await flushPromises();
    expect(wrapper.text()).toContain('场景索引完成：新增 3，检查 2');
    expect(button(wrapper, '索引场景').element.disabled).toBe(false);
    api.indexEdition.mockRejectedValueOnce(new Error('索引暂不可用'));
    await button(wrapper, '索引场景').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('索引暂不可用');
    expect(button(wrapper, '索引场景').element.disabled).toBe(false);
  });

  it('opens reports and displays report errors without losing the edition', async () => {
    api.openReport.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('报告暂不可用'));
    const wrapper = mountPage();
    await flushPromises();
    await button(wrapper, 'HTML 报告').trigger('click');
    await flushPromises();
    expect(api.openReport).toHaveBeenCalledExactlyOnceWith('edition-a');
    await button(wrapper, 'HTML 报告').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('报告暂不可用');
    expect(wrapper.get('h1').text()).toBe('Book edition-a');
  });

  it('waits for jobs, then loads edition and usage in parallel with loading spanning the whole refresh', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const jobs = deferred<JobDto[]>();
    const detail = deferred<EditionDetailDto>();
    const usage = deferred<UsageReportDto>();
    api.jobs.mockReturnValueOnce(jobs.promise);
    api.edition.mockReturnValueOnce(detail.promise);
    api.editionUsage.mockReturnValueOnce(usage.promise);

    await button(wrapper, '刷新').trigger('click');
    expect(api.jobs).toHaveBeenCalledTimes(2);
    expect(api.edition).toHaveBeenCalledTimes(1);
    expect(api.editionUsage).toHaveBeenCalledTimes(1);
    expect(wrapper.findAll('button').some((item) => item.element.disabled && item.text().includes('刷新'))).toBe(true);

    jobs.resolve([]);
    await flushPromises();
    expect(api.edition).toHaveBeenCalledTimes(2);
    expect(api.editionUsage).toHaveBeenCalledTimes(2);
    detail.resolve(editionFixture());
    await flushPromises();
    expect(wrapper.findAll('button').some((item) => item.element.disabled && item.text().includes('刷新'))).toBe(true);

    usage.resolve(usageFixture(25));
    await flushPromises();
    expect(button(wrapper, '刷新').element.disabled).toBe(false);
    expect(wrapper.text()).toContain('25');
  });

  it('refreshes details and usage even when the first job response after starting is terminal', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const response = deferred<JobDto[]>();
    api.jobs.mockReturnValueOnce(response.promise);
    wrapper.getComponent(ParseFormStub).vm.$emit('started', jobFixture({ status: 'queued' }));
    await flushPromises();

    expect(api.jobs).toHaveBeenCalledTimes(2);
    expect(api.edition).toHaveBeenCalledTimes(1);
    response.resolve([jobFixture({ status: 'succeeded' })]);
    await flushPromises();
    expect(api.edition).toHaveBeenCalledTimes(2);
    expect(api.editionUsage).toHaveBeenCalledTimes(2);
    expect(wrapper.getComponent(JobCardStub).props('job').status).toBe('succeeded');

    await vi.advanceTimersByTimeAsync(4500);
    expect(api.jobs).toHaveBeenCalledTimes(2);
  });

  it('merges the returned job immutably and keeps polling when the first refresh fails', async () => {
    const previousJobs = [jobFixture({ id: 'older-job', status: 'succeeded' })];
    api.jobs.mockResolvedValueOnce(previousJobs);
    const wrapper = mountPage();
    await flushPromises();
    api.jobs.mockRejectedValueOnce(new Error('任务暂不可用'));
    wrapper.getComponent(ParseFormStub).vm.$emit('started', jobFixture({ status: 'queued' }));
    await flushPromises();

    expect(previousJobs).toEqual([jobFixture({ id: 'older-job', status: 'succeeded' })]);
    expect(wrapper.findAllComponents(JobCardStub).map((card) => card.props('job').id)).toEqual(['job-1', 'older-job']);
    expect(wrapper.get('[role="alert"]').text()).toContain('任务暂不可用');
    expect(api.edition).toHaveBeenCalledTimes(2);
    expect(api.editionUsage).toHaveBeenCalledTimes(2);

    api.jobs.mockResolvedValue([jobFixture({ status: 'succeeded' })]);
    await vi.advanceTimersByTimeAsync(1500);
    await flushPromises();
    expect(api.jobs).toHaveBeenCalledTimes(3);
    expect(api.edition).toHaveBeenCalledTimes(3);
    expect(api.editionUsage).toHaveBeenCalledTimes(3);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(4500);
    expect(api.jobs).toHaveBeenCalledTimes(3);
  });

  it('replaces a matching returned job without duplicating it', async () => {
    api.jobs.mockResolvedValueOnce([jobFixture({ status: 'queued' })]);
    const wrapper = mountPage();
    await flushPromises();
    api.jobs.mockRejectedValueOnce(new Error('任务暂不可用'));
    wrapper.getComponent(ParseFormStub).vm.$emit('started', jobFixture({ status: 'running' }));
    await flushPromises();

    const cards = wrapper.findAllComponents(JobCardStub);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.props('job').status).toBe('running');
  });

  it('uses the same refresh for cancellation changes', async () => {
    api.jobs.mockResolvedValueOnce([jobFixture()]);
    const wrapper = mountPage();
    await flushPromises();
    const response = deferred<JobDto[]>();
    api.jobs.mockReturnValueOnce(response.promise);
    await wrapper.getComponent(JobCardStub).trigger('click');

    expect(api.jobs).toHaveBeenCalledTimes(2);
    expect(api.edition).toHaveBeenCalledTimes(1);
    response.resolve([jobFixture({ status: 'cancelled' })]);
    await flushPromises();
    expect(api.edition).toHaveBeenCalledTimes(2);
    expect(api.editionUsage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.jobs).toHaveBeenCalledTimes(2);
  });

  it('refreshes the active-to-terminal polling result before stopping requests', async () => {
    api.jobs.mockResolvedValueOnce([jobFixture()]);
    const wrapper = mountPage();
    await flushPromises();
    const response = deferred<JobDto[]>();
    api.jobs.mockReturnValueOnce(response.promise);
    await vi.advanceTimersByTimeAsync(1500);
    expect(api.jobs).toHaveBeenCalledTimes(2);
    expect(api.edition).toHaveBeenCalledTimes(1);
    response.resolve([jobFixture({ status: 'succeeded' })]);
    await flushPromises();

    expect(api.edition).toHaveBeenCalledTimes(2);
    expect(api.editionUsage).toHaveBeenCalledTimes(2);
    expect(wrapper.getComponent(JobCardStub).props('job').status).toBe('succeeded');
    await vi.advanceTimersByTimeAsync(4500);
    expect(api.jobs).toHaveBeenCalledTimes(2);
  });

  it('does not discard a start refresh while an earlier poll is still in flight', async () => {
    api.jobs.mockResolvedValueOnce([jobFixture()]);
    const wrapper = mountPage();
    await flushPromises();
    const oldPoll = deferred<JobDto[]>();
    const started = deferred<JobDto[]>();
    api.jobs.mockReturnValueOnce(oldPoll.promise).mockReturnValueOnce(started.promise);
    await vi.advanceTimersByTimeAsync(1500);
    wrapper.getComponent(ParseFormStub).vm.$emit('started', jobFixture({ id: 'new-job', status: 'queued' }));
    await flushPromises();
    expect(api.jobs).toHaveBeenCalledTimes(3);

    started.resolve([jobFixture({ id: 'new-job', status: 'succeeded' })]);
    await flushPromises();
    expect(api.edition).toHaveBeenCalledTimes(2);
    expect(api.editionUsage).toHaveBeenCalledTimes(2);
    oldPoll.resolve([jobFixture()]);
    await flushPromises();
    expect(api.edition).toHaveBeenCalledTimes(2);
    expect(api.editionUsage).toHaveBeenCalledTimes(2);
    expect(wrapper.findAllComponents(JobCardStub).map((card) => card.props('job').id)).toEqual(['new-job']);
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.jobs).toHaveBeenCalledTimes(3);
  });

  it('displays jobs and usage failures and recovers both through manual refresh', async () => {
    api.jobs.mockRejectedValueOnce(new Error('任务加载失败'));
    api.editionUsage.mockRejectedValueOnce(new Error('用量加载失败'));
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('[role="alert"]').map((alert) => alert.text())).toEqual(
      expect.arrayContaining(['任务加载失败', '用量加载失败']),
    );

    await button(wrapper, '刷新').trigger('click');
    await flushPromises();
    expect(api.jobs).toHaveBeenCalledTimes(2);
    expect(api.editionUsage).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('keeps manual retry available when the very first edition request fails', async () => {
    api.edition.mockRejectedValueOnce(new Error('版本加载失败'));
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('版本加载失败');
    await button(wrapper, '刷新').trigger('click');
    await flushPromises();

    expect(api.jobs).toHaveBeenCalledTimes(2);
    expect(api.editionUsage).toHaveBeenCalledTimes(2);
    expect(wrapper.get('h1').text()).toBe('Book edition-a');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('does not chain more requests when an in-flight refresh finishes after unmount', async () => {
    api.jobs.mockResolvedValueOnce([jobFixture()]);
    const wrapper = mountPage();
    await flushPromises();
    const response = deferred<JobDto[]>();
    api.jobs.mockReturnValueOnce(response.promise);
    await vi.advanceTimersByTimeAsync(1500);
    expect(api.jobs).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    response.resolve([jobFixture()]);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(4500);

    expect(api.jobs).toHaveBeenCalledTimes(2);
    expect(api.edition).toHaveBeenCalledTimes(1);
    expect(api.editionUsage).toHaveBeenCalledTimes(1);
  });
});

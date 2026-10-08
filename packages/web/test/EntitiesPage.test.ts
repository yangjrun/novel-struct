import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import type { EditionDetailDto } from '@novelstruct/api/contracts';
import EntitiesPage from '../src/pages/EntitiesPage.vue';
import { api } from './helpers/api-mock.js';
import { button, deferred } from './helpers/component.js';
import { editionFixture, entityFixture, voiceFixture } from './helpers/fixtures.js';

vi.mock('../src/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api.js')>()),
  api: (await import('./helpers/api-mock.js')).api,
}));

enableAutoUnmount(afterEach);

function mountPage() {
  return mount(EntitiesPage, {
    props: { editionId: 'edition-a' },
    global: { stubs: { RouterLink: RouterLinkStub } },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  api.entities.mockResolvedValue([entityFixture()]);
  api.edition.mockResolvedValue(editionFixture());
  api.voiceProfiles.mockResolvedValue([]);
  api.setVoiceProfile.mockResolvedValue({ entityId: 'entity-1' });
});

describe('EntitiesPage loading and recovery', () => {
  it('loads the edition once and only fetches voices after its book ID is ready', async () => {
    const response = deferred<EditionDetailDto>();
    api.edition.mockReturnValue(response.promise);
    mountPage();
    await flushPromises();

    expect(api.edition).toHaveBeenCalledTimes(1);
    expect(api.voiceProfiles).not.toHaveBeenCalled();
    response.resolve(editionFixture('edition-a', 'resolved-book'));
    await flushPromises();

    expect(api.voiceProfiles).toHaveBeenCalledExactlyOnceWith('resolved-book');
    expect(api.entities).toHaveBeenCalledExactlyOnceWith('edition-a');
  });

  it('surfaces edition failure without fetching voices and recovers on manual refresh', async () => {
    api.edition.mockRejectedValue(new Error('版本不可用'));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('版本不可用');
    expect(api.voiceProfiles).not.toHaveBeenCalled();
    api.edition.mockResolvedValue(editionFixture());
    await button(wrapper, '刷新').trigger('click');
    await flushPromises();

    expect(api.edition).toHaveBeenCalledTimes(2);
    expect(api.voiceProfiles).toHaveBeenCalledExactlyOnceWith('book-a');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('shows voices failures and retries once when the edition object changes but the book ID does not', async () => {
    api.voiceProfiles.mockRejectedValueOnce(new Error('声音不可用'));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('声音不可用');
    api.edition.mockResolvedValue(editionFixture());
    api.voiceProfiles.mockResolvedValue([voiceFixture()]);
    await button(wrapper, '刷新').trigger('click');
    await flushPromises();

    expect(api.edition).toHaveBeenCalledTimes(2);
    expect(api.voiceProfiles).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('test-provider / voice-1');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('reloads voices without waiting for an unrelated slow entities request', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const entities = deferred<ReturnType<typeof entityFixture>[]>();
    api.entities.mockReturnValueOnce(entities.promise);
    await button(wrapper, '刷新').trigger('click');
    await flushPromises();
    try {
      expect(api.voiceProfiles).toHaveBeenCalledTimes(2);
      expect(button(wrapper, '刷新').element.disabled).toBe(true);
    } finally {
      entities.resolve([entityFixture()]);
      await flushPromises();
    }
    expect(button(wrapper, '刷新').element.disabled).toBe(false);
  });

  it('reloads only voice profiles after saving', async () => {
    const wrapper = mountPage();
    await flushPromises();
    await button(wrapper, '配置声音').trigger('click');
    await wrapper.get('input[aria-label="声音服务"]').setValue('test-provider');
    await wrapper.get('input[aria-label="voice ID"]').setValue('voice-1');
    api.voiceProfiles.mockResolvedValue([voiceFixture()]);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.setVoiceProfile).toHaveBeenCalledExactlyOnceWith('book-a', 'entity-1', 'test-provider', 'voice-1');
    expect(api.edition).toHaveBeenCalledTimes(1);
    expect(api.entities).toHaveBeenCalledTimes(1);
    expect(api.voiceProfiles).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('test-provider / voice-1');
    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('shows save errors, preserves the form, and lets the user retry', async () => {
    api.setVoiceProfile.mockRejectedValueOnce(new Error('声音保存失败'));
    const wrapper = mountPage();
    await flushPromises();
    await button(wrapper, '配置声音').trigger('click');
    await wrapper.get('input[aria-label="声音服务"]').setValue('test-provider');
    await wrapper.get('input[aria-label="voice ID"]').setValue('voice-1');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('声音保存失败');
    expect(wrapper.find('form').exists()).toBe(true);
    expect(api.voiceProfiles).toHaveBeenCalledTimes(1);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.setVoiceProfile).toHaveBeenCalledTimes(2);
    expect(api.voiceProfiles).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('does not reuse a stale book ID while edition refresh has failed', async () => {
    const wrapper = mountPage();
    await flushPromises();
    api.edition.mockRejectedValueOnce(new Error('版本刷新失败'));
    await button(wrapper, '刷新').trigger('click');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('版本刷新失败');
    expect(api.voiceProfiles).toHaveBeenCalledTimes(1);
    await button(wrapper, '刷新').trigger('click');
    await flushPromises();
    expect(api.voiceProfiles).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('does not reload voices when a save completes after unmount', async () => {
    const saved = deferred<{ entityId: string }>();
    api.setVoiceProfile.mockReturnValueOnce(saved.promise);
    const wrapper = mountPage();
    await flushPromises();
    await button(wrapper, '配置声音').trigger('click');
    await wrapper.get('form').trigger('submit');
    wrapper.unmount();
    saved.resolve({ entityId: 'entity-1' });
    await flushPromises();

    expect(api.voiceProfiles).toHaveBeenCalledTimes(1);
  });

  it('does not start a dependent voices request after unmount', async () => {
    const response = deferred<EditionDetailDto>();
    api.edition.mockReturnValue(response.promise);
    const wrapper = mountPage();
    wrapper.unmount();
    response.resolve(editionFixture());
    await flushPromises();

    expect(api.voiceProfiles).not.toHaveBeenCalled();
  });
});

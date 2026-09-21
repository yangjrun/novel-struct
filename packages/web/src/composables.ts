import { onUnmounted, ref, shallowRef, type Ref } from 'vue';
import { errorMessage } from './api.js';

export interface AsyncState<T> {
  readonly data: Ref<T | undefined>;
  readonly loading: Ref<boolean>;
  readonly error: Ref<string | null>;
  reload(): Promise<void>;
}

/** Loads once on creation and exposes reload; the last error wins, the last data stays visible while reloading. */
export function useAsync<T>(load: () => Promise<T>): AsyncState<T> {
  const data = shallowRef<T | undefined>(undefined);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let version = 0;

  async function reload(): Promise<void> {
    const mine = (version += 1);
    loading.value = true;
    try {
      const value = await load();
      if (mine !== version) return;
      data.value = value;
      error.value = null;
    } catch (e) {
      if (mine !== version) return;
      error.value = errorMessage(e);
    } finally {
      if (mine === version) loading.value = false;
    }
  }

  void reload();
  return { data, loading, error, reload };
}

/** Calls `tick` every `intervalMs` while `active()` is true; stops on unmount. */
export function usePolling(tick: () => Promise<void>, active: () => boolean, intervalMs: number): { stop(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(async () => {
      if (active()) await tick();
      schedule();
    }, intervalMs);
  };
  schedule();

  const stop = (): void => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
  onUnmounted(stop);
  return { stop };
}

import { defineComponent, type PropType } from 'vue';
import type { DOMWrapper, VueWrapper } from '@vue/test-utils';
import type { JobDto } from '@novelstruct/api/contracts';

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: Error) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function button(wrapper: VueWrapper, label: string): DOMWrapper<HTMLButtonElement> {
  const match = wrapper.findAll<HTMLButtonElement>('button').find((candidate) => candidate.text() === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

export const ParseFormStub = defineComponent({
  name: 'ParseForm',
  emits: ['started'],
  template: '<div class="parse-form-stub" />',
});

export const JobCardStub = defineComponent({
  name: 'JobCard',
  props: { job: { type: Object as PropType<JobDto>, required: true } },
  emits: ['changed'],
  template: '<button class="job-card-stub" @click="$emit(\'changed\')">{{ job.id }} {{ job.status }}</button>',
});

export const editionStubs = {
  ParseForm: ParseFormStub,
  JobCard: JobCardStub,
  WeKnoraPanel: true,
};

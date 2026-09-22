import { createRouter, createWebHistory } from 'vue-router';
import ChapterPage from './pages/ChapterPage.vue';
import EditionPage from './pages/EditionPage.vue';
import EntitiesPage from './pages/EntitiesPage.vue';
import JobsPage from './pages/JobsPage.vue';
import LibraryPage from './pages/LibraryPage.vue';
import UsagePage from './pages/UsagePage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'library', component: LibraryPage },
    { path: '/editions/:editionId', name: 'edition', component: EditionPage, props: true },
    {
      path: '/editions/:editionId/chapters/:index',
      name: 'chapter',
      component: ChapterPage,
      props: (route) => ({ editionId: route.params['editionId'], index: Number(route.params['index']) }),
    },
    { path: '/editions/:editionId/entities', name: 'entities', component: EntitiesPage, props: true },
    { path: '/jobs', name: 'jobs', component: JobsPage },
    { path: '/usage', name: 'usage', component: UsagePage },
  ],
});

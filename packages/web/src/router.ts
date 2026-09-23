import { createRouter, createWebHistory } from 'vue-router';
import ChapterPage from './pages/ChapterPage.vue';
import EditionPage from './pages/EditionPage.vue';
import EntitiesPage from './pages/EntitiesPage.vue';
import JobsPage from './pages/JobsPage.vue';
import LibraryPage from './pages/LibraryPage.vue';
import UsagePage from './pages/UsagePage.vue';
import SearchPage from './pages/SearchPage.vue';
import TimelinePage from './pages/TimelinePage.vue';
import ReviewsPage from './pages/ReviewsPage.vue';

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
    { path: '/editions/:editionId/timeline', name: 'timeline', component: TimelinePage, props: true },
    { path: '/books/:bookId/reviews', name: 'reviews', component: ReviewsPage, props: true },
    { path: '/jobs', name: 'jobs', component: JobsPage },
    { path: '/usage', name: 'usage', component: UsagePage },
    { path: '/search', name: 'search', component: SearchPage },
  ],
});

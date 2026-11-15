import { createRouter, createWebHistory } from 'vue-router'

import { isAuthenticated } from '@/lib/session'
import HomeView from '../views/HomeView.vue'
import LoginView from '../views/LoginView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'login',
      component: LoginView,
    },
    {
      path: '/mision',
      name: 'home',
      component: HomeView,
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach((to) => {
  const authed = isAuthenticated()
  if (to.meta.requiresAuth && !authed) return { name: 'login' }
  if (to.name === 'login' && authed) return { name: 'home' }
})

export default router

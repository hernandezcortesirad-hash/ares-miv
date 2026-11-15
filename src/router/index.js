import { createRouter, createWebHistory } from 'vue-router'

import { isAuthenticated } from '@/lib/session'
import HomeView from '../views/HomeView.vue'
import LoginView from '../views/LoginView.vue'

const router = createRouter({
  // En GitHub Pages BASE_URL es './', así que el workflow pasa la ruta real (/<repo>/).
  history: createWebHistory(import.meta.env.VITE_ROUTER_BASE || import.meta.env.BASE_URL),
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

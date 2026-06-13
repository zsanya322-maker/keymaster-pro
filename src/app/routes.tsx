import React from 'react'
import { DashboardPage } from '../pages/DashboardPage'
import { InterceptionPage } from '../pages/InterceptionPage'
import { AutomationPage } from '../pages/AutomationPage'
import { SettingsPage } from '../pages/SettingsPage'

export type RouteId = 'dashboard' | 'interception' | 'automation' | 'settings'

/** Новая четырехуровневая структура роутов */
export const routes: Record<RouteId, { component: React.ComponentType<any>; label: string; icon: string }> = {
  dashboard: { component: DashboardPage, label: 'nav.dashboard', icon: 'LayoutDashboard' },
  interception: { component: InterceptionPage, label: 'nav.remapping', icon: 'Keyboard' },
  automation: { component: AutomationPage, label: 'nav.macros', icon: 'Play' },
  settings: { component: SettingsPage, label: 'nav.settings', icon: 'Settings' },
}
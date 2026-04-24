import React from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { List, Calendar, Settings, ScrollText, Tag } from 'lucide-react';
import ListView from './pages/ListView';
import CalendarView from './pages/CalendarView';
import SettingsPage from './pages/SettingsPage';
import LogsPage from './pages/LogsPage';
import TagsPage from './pages/TagsPage';

const navItems = [
  { to: '/', icon: List, label: 'Recordings', end: true },
  { to: '/calendar', icon: Calendar, label: 'Calendar' },
  { to: '/tags', icon: Tag, label: 'Tags' },
  { to: '/logs', icon: ScrollText, label: 'Logs' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-background">
        {/* Sidebar */}
        <nav className="w-16 md:w-56 flex flex-col border-r border-border bg-card shrink-0">
          <div className="p-4 border-b border-border">
            <span className="hidden md:block text-lg font-bold text-foreground">AudioVault</span>
            <span className="md:hidden text-lg font-bold text-foreground">AV</span>
          </div>
          <ul className="flex flex-col gap-1 p-2 flex-1">
            {navItems.map(({ to, icon: Icon, label, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="hidden md:block">{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<ListView />} />
            <Route path="/calendar" element={<CalendarView />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

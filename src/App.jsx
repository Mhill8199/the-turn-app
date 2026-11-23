import { useState } from 'react';
import { Sun, Moon, Shirt, Compass, Briefcase, Users, Crown, LogIn, LogOut } from 'lucide-react';
import { useTheme } from './context/ThemeContext';
import { useAuth } from './context/AuthContext';
import PrepWardrobe from './pages/PrepWardrobe';
import CourseLayout from './pages/CourseLayout';
import StockBag, { DEFAULT_CUSTOM_BAG } from './pages/StockBag';
import FoursomeHub from './pages/FoursomeHub';
import AuthModal from './components/AuthModal';

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const { user, profile, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState('course');
  const [demoPro, setDemoPro] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);

  const [clubs, setClubs] = useState(() => {
    try {
      const saved = localStorage.getItem('the-turn-bag');
      return saved ? JSON.parse(saved) : DEFAULT_CUSTOM_BAG;
    } catch {
      return DEFAULT_CUSTOM_BAG;
    }
  });

  const isPro = profile?.tier === 'tour_pro' || demoPro;

  return (
    <div className="min-h-screen max-w-md mx-auto flex flex-col">
      <header
        className="sticky top-0 z-20 px-4 py-3.5 border-b backdrop-blur-md flex items-center justify-between"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center">
          <span className="text-lg font-bold tracking-tight">THE TURN</span>
          <span
            className="ml-2 text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: isPro ? 'var(--accent-gold)' : 'var(--bg-elevated)',
              color: isPro ? '#111412' : 'var(--text-secondary)',
            }}
          >
            {isPro ? 'Tour Pro' : 'Clubhouse'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setDemoPro(!demoPro)}
            className="text-[11px] px-2.5 py-1.5 rounded-lg border font-medium"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
          >
            {isPro ? 'Free View' : 'Pro View'}
          </button>

          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg border"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
            aria-label="Toggle Light and Dark Mode"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {user ? (
            <button
              onClick={signOut}
              className="p-2 rounded-lg border"
              style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
              title="Sign Out"
            >
              <LogOut size={15} />
            </button>
          ) : (
            <button
              onClick={() => setAuthOpen(true)}
              className="p-2 rounded-lg border"
              style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
              title="Sign In"
            >
              <LogIn size={15} />
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 px-4 pt-4">
        {activeTab === 'course' && <CourseLayout clubs={clubs} isPro={isPro} onOpenPaywall={setPaywallFeature} />}
        {activeTab === 'bag' && <StockBag clubs={clubs} setClubs={setClubs} />}
        {activeTab === 'foursome' && <FoursomeHub />}
        {activeTab === 'prep' && <PrepWardrobe isPro={isPro} onOpenPaywall={setPaywallFeature} />}
      </main>

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}

      {paywallFeature && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-end justify-center p-4">
          <div className="w-full max-w-md rounded-2xl p-5 border space-y-4" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center gap-2 text-amber-500 font-semibold text-sm">
              <Crown size={18} /> Unlock Tour Pro
            </div>
            <h3 className="text-lg font-bold">{paywallFeature}</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Upgrade to Tour Pro ($49.99/yr) for full-bag atmospheric shot simulations, dew-point rollout adjustments, AI flat-lay closet photos, and Apple Watch / Meta Glasses caddie sync.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { setDemoPro(true); setPaywallFeature(null); }}
                className="flex-1 py-3 rounded-xl font-semibold text-sm text-white"
                style={{ backgroundColor: 'var(--accent-emerald)' }}
              >
                Start 14-Day Free Trial
              </button>
              <button
                onClick={() => setPaywallFeature(null)}
                className="px-4 py-3 rounded-xl border text-sm"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <nav
        className="sticky bottom-0 z-20 border-t px-2 py-2 grid grid-cols-4 gap-1 backdrop-blur-md"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        {[
          { id: 'course', label: 'Course', icon: Compass },
          { id: 'bag', label: 'My Bag', icon: Briefcase },
          { id: 'foursome', label: 'Foursome', icon: Users },
          { id: 'prep', label: 'Prep & Fit', icon: Shirt },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex flex-col items-center py-1.5 rounded-xl text-xs font-medium transition"
              style={{ color: active ? 'var(--accent-emerald)' : 'var(--text-secondary)' }}
            >
              <Icon size={18} className="mb-1" />
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

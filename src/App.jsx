import { useState, useEffect } from 'react';
import { Sun, Moon, Shirt, Compass, Briefcase, Users, Crown, LogIn, LogOut, Watch, Glasses, X, ShieldCheck, Check, Loader2 } from 'lucide-react';
import { useTheme } from './context/ThemeContext';
import { useAuth } from './context/AuthContext';
import { supabase } from './lib/supabase';
import PrepWardrobe from './pages/PrepWardrobe';
import CourseLayout from './pages/CourseLayout';
import StockBag, { DEFAULT_CUSTOM_BAG } from './pages/StockBag';
import FoursomeHub from './pages/FoursomeHub';
import AuthModal from './components/AuthModal';

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const { user, profile, signOut, refreshProfile } = useAuth();
  const [activeTab, setActiveTab] = useState('course');
  const [demoPro, setDemoPro] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState('solo'); // 'solo' ($119.99/yr) | 'foursome' ($299.99/yr)
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [upgradeBanner, setUpgradeBanner] = useState('');
  const [authOpen, setAuthOpen] = useState(false);
  const [wearableOpen, setWearableOpen] = useState(false);

  const [clubs, setClubs] = useState(() => {
    try {
      const saved = localStorage.getItem('the-turn-bag');
      return saved ? JSON.parse(saved) : DEFAULT_CUSTOM_BAG;
    } catch {
      return DEFAULT_CUSTOM_BAG;
    }
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgrade') === 'success') {
      setUpgradeBanner('Welcome to Tour Pro! Your membership is active.');
      refreshProfile?.();
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('upgrade') === 'cancelled') {
      setUpgradeBanner('Checkout cancelled — your Clubhouse free access remains active.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [refreshProfile]);

  const handleStartCheckout = async () => {
    setCheckoutError('');

    if (!user) {
      setPaywallFeature(null);
      setAuthOpen(true);
      return;
    }

    setCheckoutLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: {
          plan: selectedPlan,
          userId: user.id,
          email: user.email,
          returnUrl: window.location.origin,
        },
      });

      if (error) throw new Error(error.message || 'Unable to start Stripe Checkout');
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL returned from server');
      }
    } catch (err) {
      // Fallback preview mode if Stripe Edge Function secrets are not configured yet
      setCheckoutError(err.message);
      setDemoPro(true);
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (window.location.pathname === '/privacy-policy') {
    return (
      <div className="min-h-screen max-w-xl mx-auto px-5 py-10 space-y-5">
        <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <h1 className="text-xl font-bold">The Turn — Privacy Policy</h1>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Operated by Solis Noir LLC • Effective November 2026</p>
          </div>
          <a href="/" className="text-xs font-semibold px-3 py-2 rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
            Back to App
          </a>
        </div>
        <div className="space-y-3 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          <p><strong style={{ color: 'var(--text-primary)' }}>1. Data We Collect:</strong> Account email, display name, custom golf club stock yardages, wardrobe items, and optional GPS coordinates used solely to fetch local course weather, dew point, wind, and elevation.</p>
          <p><strong style={{ color: 'var(--text-primary)' }}>2. Wearables & SMS Invites:</strong> Optional Apple Watch, Garmin, and Meta smart glasses integrations read your stock yardages and active hole notes on-demand. Foursome SMS links are initiated directly from your device.</p>
          <p><strong style={{ color: 'var(--text-primary)' }}>3. Data Security & Deletion:</strong> All user records are stored with Row-Level Security via Supabase. You may request account or data deletion anytime by contacting Solis Noir LLC.</p>
        </div>
      </div>
    );
  }

  const isPro = profile?.tier === 'tour_pro' || demoPro;
  const leadClub = clubs[1] || clubs[0];

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
        {upgradeBanner && (
          <div className="mb-3 p-3 rounded-xl border text-xs font-semibold flex items-center justify-between" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-emerald)', color: 'var(--accent-emerald)' }}>
            <span>{upgradeBanner}</span>
            <button onClick={() => setUpgradeBanner('')}><X size={14} /></button>
          </div>
        )}

        {activeTab === 'course' && (
          <CourseLayout
            clubs={clubs}
            isPro={isPro}
            onOpenPaywall={(feat) => { setCheckoutError(''); setPaywallFeature(feat); }}
            onOpenWearable={() => setWearableOpen(true)}
          />
        )}
        {activeTab === 'bag' && <StockBag clubs={clubs} setClubs={setClubs} />}
        {activeTab === 'foursome' && <FoursomeHub />}
        {activeTab === 'prep' && <PrepWardrobe isPro={isPro} onOpenPaywall={(feat) => { setCheckoutError(''); setPaywallFeature(feat); }} />}

        <div className="text-center pb-24 pt-2">
          <a href="/privacy-policy" className="text-[11px] inline-flex items-center gap-1 opacity-60 hover:opacity-100">
            <ShieldCheck size={12} /> Solis Noir LLC • Privacy Policy
          </a>
        </div>
      </main>

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}

      {wearableOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl p-5 border space-y-4" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-gold)' }}>
                Wearable Caddie Preview
              </span>
              <button onClick={() => setWearableOpen(false)}><X size={18} /></button>
            </div>

            <div className="p-4 rounded-2xl border space-y-1.5" style={{ backgroundColor: '#0B0D0C', borderColor: '#2B352F', color: '#F3F4F1' }}>
              <div className="flex items-center justify-between text-[11px] text-emerald-400 font-mono">
                <span className="flex items-center gap-1"><Watch size={13} /> APPLE WATCH • LIVE ACTIVITY</span>
                <span>HOLE 4</span>
              </div>
              <div className="text-base font-bold">{leadClub?.club_type} • {leadClub?.carry_yards}y Stock</div>
              <div className="text-xs text-zinc-400">Leaves 148y approach • Favor left-center fairway</div>
            </div>

            <div className="p-4 rounded-2xl border space-y-1.5" style={{ backgroundColor: '#0B0D0C', borderColor: '#2B352F', color: '#F3F4F1' }}>
              <div className="flex items-center justify-between text-[11px] text-amber-400 font-mono">
                <span className="flex items-center gap-1"><Glasses size={13} /> META RAY-BAN • VOICE & HUD</span>
                <span>HANDS-FREE</span>
              </div>
              <div className="text-xs italic text-zinc-300">&ldquo;Hey Meta, ask The Turn what club I&apos;m hitting.&rdquo;</div>
              <div className="text-xs text-emerald-400">
                &ldquo;Pull {leadClub?.club_type}. Current wind and dew point keep your rollout short of the right bunker.&rdquo;
              </div>
            </div>
          </div>
        </div>
      )}

      {paywallFeature && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl p-5 border space-y-4" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-500 font-semibold text-xs uppercase tracking-wider">
                <Crown size={16} /> Tour Pro Membership
              </div>
              <button onClick={() => setPaywallFeature(null)} className="p-1 opacity-75 hover:opacity-100">
                <X size={18} />
              </button>
            </div>

            <div>
              <h3 className="text-lg font-bold">{paywallFeature}</h3>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                Full-bag atmospheric shot simulations, live dew-point & wind physics, custom course/hole builder, Hard Mode trip packing, and Apple Watch / Meta Glasses sync.
              </p>
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => setSelectedPlan('solo')}
                className="w-full text-left p-3.5 rounded-xl border transition flex items-center justify-between"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: selectedPlan === 'solo' ? 'var(--accent-emerald)' : 'var(--border-subtle)',
                  borderWidth: selectedPlan === 'solo' ? '2px' : '1px',
                }}
              >
                <div>
                  <div className="font-bold text-sm flex items-center gap-2">
                    Tour Pro Annual
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-700/20 text-emerald-500">
                      14-Day Free Trial
                    </span>
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    1 golfer • Unlimited bag, courses & wearables
                  </div>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="font-mono font-bold text-base">$119.99</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>per year</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedPlan('foursome')}
                className="w-full text-left p-3.5 rounded-xl border transition flex items-center justify-between"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: selectedPlan === 'foursome' ? 'var(--accent-gold)' : 'var(--border-subtle)',
                  borderWidth: selectedPlan === 'foursome' ? '2px' : '1px',
                }}
              >
                <div>
                  <div className="font-bold text-sm flex items-center gap-2">
                    Foursome Crew Pass
                    <span
                      className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--accent-gold)', color: '#111412' }}
                    >
                      4 Seats • Save $180
                    </span>
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    4 Tour Pro accounts (~$75/player) + crew hub
                  </div>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="font-mono font-bold text-base" style={{ color: 'var(--accent-gold)' }}>$299.99</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>per year</div>
                </div>
              </button>
            </div>

            {checkoutError && (
              <p className="text-[11px] text-amber-500">
                Stripe sandbox notice ({checkoutError}) — enabled local Pro preview so you can keep testing.
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={checkoutLoading}
                onClick={handleStartCheckout}
                className="flex-1 py-3 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-1.5"
                style={{ backgroundColor: 'var(--accent-emerald)' }}
              >
                {checkoutLoading ? (
                  <><Loader2 size={16} className="animate-spin" /> Redirecting to Stripe...</>
                ) : (
                  <>
                    <Check size={16} />
                    {selectedPlan === 'solo'
                      ? 'Checkout Tour Pro ($119.99/yr)'
                      : 'Checkout Foursome ($299.99/yr)'}
                  </>
                )}
              </button>
              <button
                type="button"
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

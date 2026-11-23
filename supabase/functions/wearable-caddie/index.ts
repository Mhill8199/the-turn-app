import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ClubRow {
  club_type: string;
  carry_yards: number;
  total_yards?: number | null;
}

interface WeatherConditions {
  tempF: number;
  dewPointF: number;
  windSpeedMph: number;
  windDirDeg: number;
  elevationFt: number;
  isLive: boolean;
}

async function fetchLiveWeatherAndElevation(lat: number, lon: number): Promise<WeatherConditions> {
  const [wxRes, elevRes] = await Promise.all([
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,dew_point_2m,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`
    ),
    fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`),
  ]);

  if (!wxRes.ok) {
    throw new Error('Failed to fetch live weather from Open-Meteo');
  }

  const wxData = await wxRes.json();
  const c = wxData.current ?? {};

  let elevationFt = 800;
  if (elevRes.ok) {
    const elevData = await elevRes.json();
    const meters = Array.isArray(elevData.elevation) ? elevData.elevation[0] : elevData.elevation;
    if (typeof meters === 'number') {
      elevationFt = Math.round(meters * 3.28084);
    }
  }

  return {
    tempF: Math.round(c.temperature_2m ?? 68),
    dewPointF: Math.round(c.dew_point_2m ?? 52),
    windSpeedMph: Math.round(c.wind_speed_10m ?? 0),
    windDirDeg: Math.round(c.wind_direction_10m ?? 0),
    elevationFt,
    isLive: true,
  };
}

function adjustClubDistances(club: ClubRow, wx: WeatherConditions, holeBearingDeg: number) {
  const stockCarry = Number(club.carry_yards) || 150;
  const stockTotal = Number(club.total_yards) || stockCarry + 5;

  const relRad = ((wx.windDirDeg - holeBearingDeg) * Math.PI) / 180;
  const headwindMph = Math.round(Math.cos(relRad) * wx.windSpeedMph);

  const windFactor = headwindMph >= 0
    ? 1 - headwindMph * 0.01
    : 1 + Math.abs(headwindMph) * 0.0055;

  const tempFactor = 1 + ((wx.tempF - 70) / 20) * 0.015;
  const elevationFactor = 1 + (wx.elevationFt / 1000) * 0.015;

  const adjustedCarry = Math.round(stockCarry * windFactor * tempFactor * elevationFactor);

  const dewSpread = wx.tempF - wx.dewPointF;
  const baseRollout = Math.max(0, stockTotal - stockCarry);
  const turfMultiplier = dewSpread <= 4 ? 0.55 : dewSpread <= 10 ? 0.85 : 1.15;
  const adjustedTotal = Math.round(adjustedCarry + baseRollout * turfMultiplier);

  const turfCondition = dewSpread <= 4
    ? 'heavy dew and soft turf'
    : dewSpread <= 10
    ? 'balanced turf'
    : 'dry firm turf';

  return {
    stockCarry,
    stockTotal,
    adjustedCarry,
    adjustedTotal,
    headwindMph,
    turfCondition,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const targetYards = Math.max(20, Number(url.searchParams.get('yards') || 165));
    const latParam = url.searchParams.get('lat');
    const lonParam = url.searchParams.get('lon');
    const holeBearingDeg = Number(url.searchParams.get('bearing') || 145);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    );

    const { data: { user } } = await supabase.auth.getUser();

    let clubs: ClubRow[] = [
      { club_type: 'Driver', carry_yards: 245, total_yards: 265 },
      { club_type: '3-Wood', carry_yards: 220, total_yards: 235 },
      { club_type: '4-Hybrid', carry_yards: 200, total_yards: 212 },
      { club_type: '5-Iron', carry_yards: 185, total_yards: 194 },
      { club_type: '6-Iron', carry_yards: 175, total_yards: 183 },
      { club_type: '7-Iron', carry_yards: 165, total_yards: 172 },
      { club_type: '8-Iron', carry_yards: 153, total_yards: 159 },
      { club_type: '9-Iron', carry_yards: 142, total_yards: 147 },
      { club_type: 'PW', carry_yards: 130, total_yards: 134 },
      { club_type: '52° Wedge', carry_yards: 112, total_yards: 115 },
      { club_type: '58° Wedge', carry_yards: 98, total_yards: 100 },
      { club_type: '60° Wedge', carry_yards: 82, total_yards: 83 },
    ];

    if (user) {
      const { data: userClubs } = await supabase
        .from('golf_clubs')
        .select('club_type, carry_yards, total_yards')
        .eq('user_id', user.id);

      if (userClubs && userClubs.length > 0) {
        clubs = userClubs;
      }
    }

    let weather: WeatherConditions | null = null;
    if (latParam !== null && lonParam !== null) {
      const lat = Number(latParam);
      const lon = Number(lonParam);
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        weather = await fetchLiveWeatherAndElevation(lat, lon);
      }
    }

    const candidates = clubs.map((club) => {
      if (!weather) {
        const stockCarry = Number(club.carry_yards) || 150;
        const stockTotal = Number(club.total_yards) || stockCarry + 5;
        return {
          club_type: club.club_type,
          stockCarry,
          stockTotal,
          adjustedCarry: stockCarry,
          adjustedTotal: stockTotal,
          headwindMph: 0,
          turfCondition: 'standard conditions',
        };
      }
      return {
        club_type: club.club_type,
        ...adjustClubDistances(club, weather, holeBearingDeg),
      };
    });

    const best = [...candidates].sort(
      (a, b) => Math.abs(a.adjustedCarry - targetYards) - Math.abs(b.adjustedCarry - targetYards)
    )[0];

    const spokenBrief = weather
      ? `For ${targetYards} yards at ${weather.tempF} degrees and ${weather.dewPointF} dew point, pull your ${best.club_type}. It plays ${best.adjustedCarry} yards carry (${best.stockCarry} stock) with ${best.turfCondition}.`
      : `For ${targetYards} yards, pull your ${best.club_type} (${best.stockCarry} yards stock carry).`;

    return new Response(
      JSON.stringify({
        app: 'The Turn',
        targetYards,
        recommendedClub: best.club_type,
        stockCarry: best.stockCarry,
        adjustedCarry: best.adjustedCarry,
        adjustedTotal: best.adjustedTotal,
        turfCondition: best.turfCondition,
        weather,
        spokenBrief,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

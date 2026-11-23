import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    const targetYards = Number(new URL(req.url).searchParams.get('yards') || 165);

    let recommendedClub = '7-Iron';
    let stockCarry = 165;

    if (user) {
      const { data: clubs } = await supabase
        .from('golf_clubs')
        .select('club_type, carry_yards')
        .eq('user_id', user.id);

      if (clubs && clubs.length > 0) {
        const best = clubs.sort(
          (a, b) => Math.abs(a.carry_yards - targetYards) - Math.abs(b.carry_yards - targetYards)
        )[0];
        recommendedClub = best.club_type;
        stockCarry = best.carry_yards;
      }
    }

    const spokenBrief = `For ${targetYards} yards, pull your ${recommendedClub} (${stockCarry} yards stock carry).`;

    return new Response(
      JSON.stringify({
        app: 'The Turn',
        targetYards,
        recommendedClub,
        stockCarry,
        spokenBrief,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

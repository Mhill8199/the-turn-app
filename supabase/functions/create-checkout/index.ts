import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { plan, userId, email, returnUrl } = await req.json();
    const isFoursome = plan === 'foursome';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      subscription_data: {
        trial_period_days: 14,
        metadata: { userId, plan },
      },
      metadata: { userId, plan },
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: isFoursome
                ? 'The Turn — Foursome Crew Pass (4 Tour Pro Seats)'
                : 'The Turn — Tour Pro Annual Membership',
              description: isFoursome
                ? '4 Tour Pro accounts with full atmospheric physics, custom courses, and wearables.'
                : 'Full-bag atmospheric shot simulations, dew-point & wind physics, custom courses, and wearables.',
            },
            unit_amount: isFoursome ? 29999 : 11999,
            recurring: { interval: 'year' },
          },
          quantity: 1,
        },
      ],
      success_url: `${returnUrl}?upgrade=success`,
      cancel_url: `${returnUrl}?upgrade=cancelled`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

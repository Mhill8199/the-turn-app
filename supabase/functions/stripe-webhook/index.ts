import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
});

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

function generateCrewCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `TURN-${suffix}`;
}

serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  if (!signature || !webhookSecret) {
    return new Response('Missing Stripe signature or webhook secret', { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan || 'solo';
      const email = session.customer_details?.email || session.customer_email || null;

      if (userId) {
        await supabaseAdmin
          .from('profiles')
          .upsert({ id: userId, email, tier: 'tour_pro' }, { onConflict: 'id' });

        if (plan === 'foursome') {
          const inviteCode = generateCrewCode();
          const { data: passRow } = await supabaseAdmin
            .from('crew_passes')
            .insert({
              owner_id: userId,
              invite_code: inviteCode,
              max_seats: 4,
              active: true,
            })
            .select()
            .single();

          if (passRow) {
            await supabaseAdmin.from('crew_pass_seats').insert({
              pass_id: passRow.id,
              member_id: userId,
              member_email: email,
            });
          }
        }
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.userId;

      if (userId) {
        await supabaseAdmin
          .from('profiles')
          .update({ tier: 'clubhouse' })
          .eq('id', userId);

        const { data: ownedPasses } = await supabaseAdmin
          .from('crew_passes')
          .select('id')
          .eq('owner_id', userId);

        if (ownedPasses && ownedPasses.length > 0) {
          const passIds = ownedPasses.map((p) => p.id);
          await supabaseAdmin.from('crew_passes').update({ active: false }).in('id', passIds);

          const { data: seats } = await supabaseAdmin
            .from('crew_pass_seats')
            .select('member_id')
            .in('pass_id', passIds);

          if (seats && seats.length > 0) {
            const memberIds = seats.map((s) => s.member_id);
            await supabaseAdmin.from('profiles').update({ tier: 'clubhouse' }).in('id', memberIds);
          }
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

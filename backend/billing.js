// billing.js — Stripe integration module
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Plan config — update price IDs from your Stripe dashboard
const PLANS = {
  free:       { name: "Free",       docs: 50,       price: 0,    priceId: null },
  starter:    { name: "Starter",    docs: 500,       price: 299,  priceId: process.env.STRIPE_PRICE_STARTER },
  growth:     { name: "Growth",     docs: 2000,      price: 799,  priceId: process.env.STRIPE_PRICE_GROWTH },
  enterprise: { name: "Enterprise", docs: Infinity,  price: null, priceId: process.env.STRIPE_PRICE_ENTERPRISE },
};

// ── GET OR CREATE STRIPE CUSTOMER ──────────────────────────────
async function getOrCreateCustomer(teamId, email, teamName) {
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("team_id", teamId)
    .single();

  if (sub?.stripe_customer_id) return sub.stripe_customer_id;

  const customer = await stripe.customers.create({
    email,
    name: teamName,
    metadata: { team_id: teamId },
  });

  await supabase.from("subscriptions").upsert({
    team_id: teamId,
    stripe_customer_id: customer.id,
    plan: "free",
    updated_at: new Date().toISOString(),
  }, { onConflict: "team_id" });

  return customer.id;
}

// ── CREATE CHECKOUT SESSION ─────────────────────────────────────
async function createCheckoutSession({ teamId, plan, email, teamName, successUrl, cancelUrl }) {
  const planConfig = PLANS[plan];
  if (!planConfig?.priceId) throw new Error(`Invalid plan: ${plan}`);

  const customerId = await getOrCreateCustomer(teamId, email, teamName);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: planConfig.priceId, quantity: 1 }],
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}&upgraded=true`,
    cancel_url: cancelUrl,
    subscription_data: {
      trial_period_days: 14,
      metadata: { team_id: teamId, plan },
    },
    metadata: { team_id: teamId, plan },
    allow_promotion_codes: true,
  });

  return session;
}

// ── CREATE BILLING PORTAL SESSION ──────────────────────────────
async function createPortalSession({ teamId, returnUrl }) {
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("team_id", teamId)
    .single();

  if (!sub?.stripe_customer_id) throw new Error("No billing account found");

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: returnUrl,
  });

  return session;
}

// ── HANDLE STRIPE WEBHOOK ───────────────────────────────────────
async function handleWebhook(rawBody, signature) {
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }

  const data = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const teamId = data.metadata?.team_id;
      const plan = data.metadata?.plan;
      if (teamId && plan) {
        await supabase.from("subscriptions").upsert({
          team_id: teamId,
          stripe_customer_id: data.customer,
          stripe_subscription_id: data.subscription,
          plan,
          status: "trialing",
          updated_at: new Date().toISOString(),
        }, { onConflict: "team_id" });
        // Update team plan
        await supabase.from("teams").update({ plan }).eq("id", teamId);
      }
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.created": {
      const teamId = data.metadata?.team_id;
      if (!teamId) {
        // Look up by customer ID
        const { data: sub } = await supabase.from("subscriptions").select("team_id").eq("stripe_customer_id", data.customer).single();
        if (!sub) break;
      }
      const plan = getPlanFromPriceId(data.items?.data?.[0]?.price?.id);
      const updateData = {
        stripe_subscription_id: data.id,
        stripe_price_id: data.items?.data?.[0]?.price?.id,
        status: data.status,
        plan,
        current_period_start: new Date(data.current_period_start * 1000).toISOString(),
        current_period_end: new Date(data.current_period_end * 1000).toISOString(),
        cancel_at_period_end: data.cancel_at_period_end,
        trial_end: data.trial_end ? new Date(data.trial_end * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      };
      await supabase.from("subscriptions").update(updateData).eq("stripe_subscription_id", data.id);
      if (plan) await supabase.from("teams").update({ plan }).eq("id", teamId || (await getTeamByCustomer(data.customer)));
      break;
    }

    case "customer.subscription.deleted": {
      await supabase.from("subscriptions").update({ status: "canceled", plan: "free", updated_at: new Date().toISOString() }).eq("stripe_subscription_id", data.id);
      const teamId = await getTeamByCustomer(data.customer);
      if (teamId) await supabase.from("teams").update({ plan: "free" }).eq("id", teamId);
      break;
    }

    case "invoice.payment_failed": {
      await supabase.from("subscriptions").update({ status: "past_due", updated_at: new Date().toISOString() }).eq("stripe_customer_id", data.customer);
      break;
    }

    case "invoice.payment_succeeded": {
      // Reset monthly usage counter
      const teamId = await getTeamByCustomer(data.customer);
      if (teamId) {
        await supabase.from("subscriptions").update({ docs_used_this_period: 0, status: "active", updated_at: new Date().toISOString() }).eq("team_id", teamId);
      }
      break;
    }
  }

  return { received: true, type: event.type };
}

// ── CHECK USAGE LIMIT ───────────────────────────────────────────
async function checkUsageLimit(teamId) {
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan, docs_used_this_period, status")
    .eq("team_id", teamId)
    .single();

  const plan = sub?.plan || "free";
  const used = sub?.docs_used_this_period || 0;
  const limit = PLANS[plan]?.docs || 50;
  const allowed = limit === Infinity || used < limit;

  return {
    allowed,
    plan,
    used,
    limit: limit === Infinity ? "Unlimited" : limit,
    remaining: limit === Infinity ? "Unlimited" : Math.max(0, limit - used),
    percentUsed: limit === Infinity ? 0 : Math.round((used / limit) * 100),
  };
}

// ── INCREMENT USAGE ─────────────────────────────────────────────
async function incrementUsage(teamId, userId, eventType = "invoice_processed") {
  await supabase.from("subscriptions")
    .update({ docs_used_this_period: supabase.rpc("increment", { x: 1 }) })
    .eq("team_id", teamId);

  await supabase.from("usage_events").insert({ team_id: teamId, user_id: userId, event_type: eventType });
}

// ── GET SUBSCRIPTION ────────────────────────────────────────────
async function getSubscription(teamId) {
  const { data } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("team_id", teamId)
    .single();

  const plan = data?.plan || "free";
  return {
    ...data,
    planConfig: PLANS[plan],
    allPlans: PLANS,
  };
}

// ── HELPERS ─────────────────────────────────────────────────────
function getPlanFromPriceId(priceId) {
  for (const [plan, config] of Object.entries(PLANS)) {
    if (config.priceId === priceId) return plan;
  }
  return "starter";
}

async function getTeamByCustomer(customerId) {
  const { data } = await supabase.from("subscriptions").select("team_id").eq("stripe_customer_id", customerId).single();
  return data?.team_id;
}

module.exports = { createCheckoutSession, createPortalSession, handleWebhook, checkUsageLimit, incrementUsage, getSubscription, PLANS };

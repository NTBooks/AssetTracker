import Stripe from 'stripe';

export function getStripe() {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) return null;
    return new Stripe(secret, { apiVersion: '2024-06-20' });
}

export async function createCheckoutSession({ successUrl, cancelUrl, priceInCents = 500, description = 'Asset Registration Fee' }) {
    if (process.env.FREEMODE === 'true' || process.env.FREEMODE === '1') {
        return { id: 'free_mode', url: successUrl };
    }
    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe not configured');
    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: 'usd',
                    product_data: { name: 'Asset Registration', description },
                    unit_amount: priceInCents
                },
                quantity: 1
            }
        ],
        success_url: successUrl,
        cancel_url: cancelUrl
    });
    return session;
}



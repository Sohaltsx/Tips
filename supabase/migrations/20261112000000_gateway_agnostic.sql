-- Make the tips table gateway-agnostic so Cashfree (and Razorpay) can share it.
-- Existing rows are Razorpay test tips, so they get gateway = 'razorpay'.

alter table public.tips rename column razorpay_order_id   to order_id;
alter table public.tips rename column razorpay_payment_id to payment_id;

alter table public.tips
  add column if not exists gateway text not null default 'razorpay'
    check (gateway in ('razorpay', 'cashfree'));

-- New rows must say which gateway they used.
alter table public.tips alter column gateway drop default;

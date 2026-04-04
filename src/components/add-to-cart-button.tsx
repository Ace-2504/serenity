"use client";

import { useState } from "react";

export default function AddToCartButton({
  variantId,
  disabled = false,
  disabledLabel = "Out of stock"
}: {
  variantId: string;
  disabled?: boolean;
  disabledLabel?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function addToCart() {
    setState("loading");
    const response = await fetch("/api/cart/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId, quantity: 1 })
    });

    if (!response.ok) {
      setState("error");
      return;
    }

    setState("done");
    setTimeout(() => setState("idle"), 1500);
  }

  const label =
    disabled
      ? disabledLabel
      :
    state === "loading"
      ? "Adding..."
      : state === "done"
        ? "Added"
        : state === "error"
          ? "Login Required"
          : "Add to cart";

  return (
    <button
      type="button"
      onClick={() => void addToCart()}
      disabled={state === "loading" || disabled}
      className="mt-4 w-full rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-forest disabled:cursor-not-allowed disabled:bg-graphite/55 disabled:text-canvas/90 disabled:opacity-80"
    >
      {label}
    </button>
  );
}
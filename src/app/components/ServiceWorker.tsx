"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase/supabase";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function subscribeToPush(reg: ServiceWorkerRegistration) {
  if (!VAPID_PUBLIC_KEY) return;

  // Check if already subscribed
  let sub = await reg.pushManager.getSubscription();

  if (!sub) {
    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  // Send subscription to server
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return;

  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
}

export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // Wait for SW to be ready, then try push subscription
        if (reg.active) {
          subscribeToPush(reg);
        } else {
          reg.addEventListener("updatefound", () => {
            const newWorker = reg.installing;
            newWorker?.addEventListener("statechange", () => {
              if (newWorker.state === "activated") {
                subscribeToPush(reg);
              }
            });
          });
        }
      })
      .catch(() => {});
  }, []);

  return null;
}

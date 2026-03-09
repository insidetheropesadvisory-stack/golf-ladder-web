import { Suspense } from "react";
import ProfilePageClient from "./ProfilePageClient";

function ProfileLoading() {
  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-[0_10px_28px_rgba(17,19,18,.06)]">
        Loading profile…
      </div>
    </main>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileLoading />}>
      <ProfilePageClient />
    </Suspense>
  );
}
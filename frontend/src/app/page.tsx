"use client";

import React from "react";
import Chat from "@/components/Chat";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center">
      <header className="w-full bg-blue-600 p-4 text-white text-center">
        <h1 className="text-2xl font-bold">AI Research Assistant</h1>
        <p className="text-sm">Powered by Modern AI Agent Tech Stack (2025)</p>
      </header>

      <div className="flex-1 w-full max-w-4xl p-4">
        <div className="bg-white rounded-lg shadow-lg h-[calc(100vh-8rem)]">
          <Chat />
        </div>
      </div>
    </main>
  );
}

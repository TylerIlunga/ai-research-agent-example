"use client";

import React from "react";
import Chat from "@/components/Chat";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50">
      <header className="w-full bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 shadow-xl">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <div className="text-center">
            <div className="inline-flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
                <span className="text-2xl">🔬</span>
              </div>
              <h1 className="text-4xl lg:text-5xl font-bold text-white tracking-tight">
                AI Research Assistant
              </h1>
            </div>
            <p className="text-blue-100 text-lg lg:text-xl font-medium mb-4 max-w-2xl mx-auto leading-relaxed">
              Advanced research powered by LangGraph workflows with real-time
              source synthesis and citation tracking
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full">
                <span className="text-yellow-300">⚡</span>
                <span className="text-blue-100 text-sm font-medium">
                  Multi-Agent Pipeline
                </span>
              </div>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full">
                <span className="text-green-300">🔍</span>
                <span className="text-blue-100 text-sm font-medium">
                  Live Source Tracking
                </span>
              </div>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full">
                <span className="text-purple-300">🧠</span>
                <span className="text-blue-100 text-sm font-medium">
                  Intelligent Synthesis
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 w-full max-w-7xl mx-auto p-6">
        <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/30 h-[calc(100vh-14rem)] overflow-hidden">
          <Chat />
        </div>
      </div>
    </main>
  );
}

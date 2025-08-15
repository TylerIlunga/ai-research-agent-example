import React from "react";

export interface ResearchStep {
  step: string;
  details: string;
  status: "loading" | "completed" | "error";
}

interface ResearchProgressProps {
  steps: ResearchStep[];
}

const ResearchProgress: React.FC<ResearchProgressProps> = ({ steps }) => {
  const getStepIcon = (step: string, status: string) => {
    if (status === "completed") return "✓";
    if (status === "error") return "⚠️";

    // Map step names to appropriate icons
    const stepIcons: Record<string, string> = {
      model: "🤖",
      tools: "🔧",
      compressResearch: "📝",
      search: "🔍",
      analyze: "🧠",
      synthesize: "💡",
      default: "⚡",
    };

    return stepIcons[step] || stepIcons.default;
  };

  const getStepLabel = (step: string) => {
    const stepLabels: Record<string, string> = {
      model: "AI Processing",
      tools: "Tool Execution",
      compressResearch: "Research Synthesis",
      search: "Searching",
      analyze: "Analyzing",
      synthesize: "Synthesizing",
      default: "Processing",
    };

    return stepLabels[step] || step.charAt(0).toUpperCase() + step.slice(1);
  };

  if (steps.length === 0) {
    return (
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/60 rounded-xl p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <div className="text-sm text-gray-700">Initializing research...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/60 rounded-xl p-4 mb-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
          <span className="text-white text-sm">🔬</span>
        </div>
        <div>
          <div className="text-sm font-semibold text-gray-800">
            Research Pipeline
          </div>
          <div className="text-xs text-blue-600 font-medium">
            {steps.filter((s) => s.status === "completed").length} of{" "}
            {steps.length} steps completed
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {steps.map((step, index) => (
          <div
            key={`${step.step}-${index}`}
            className="flex items-center gap-3"
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300 flex-shrink-0 ${
                step.status === "completed"
                  ? "bg-green-500 text-white shadow-md"
                  : step.status === "error"
                  ? "bg-red-500 text-white shadow-md"
                  : "bg-blue-500 text-white shadow-md animate-pulse"
              }`}
            >
              {step.status === "loading" ? (
                <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                getStepIcon(step.step, step.status)
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div
                className={`text-sm font-medium ${
                  step.status === "completed"
                    ? "text-green-700"
                    : step.status === "error"
                    ? "text-red-700"
                    : "text-blue-700"
                }`}
              >
                {getStepLabel(step.step)}
              </div>
              <div className="text-xs text-gray-600 truncate">
                {step.details}
              </div>
            </div>

            {step.status === "loading" && (
              <div className="flex space-x-1">
                <div
                  className="w-1 h-1 bg-blue-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0s" }}
                ></div>
                <div
                  className="w-1 h-1 bg-blue-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0.1s" }}
                ></div>
                <div
                  className="w-1 h-1 bg-blue-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0.2s" }}
                ></div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ResearchProgress;

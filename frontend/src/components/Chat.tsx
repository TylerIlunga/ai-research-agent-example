import React, { useState, useRef, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { Message, Source } from "@/types/chat";
import { streamQuery } from "@/services/api";
import MessageComponent from "./Message";
import ResearchProgress, { ResearchStep } from "./ResearchProgress";

interface ChatProps {
  conversationId?: string;
}

const Chat: React.FC<ChatProps> = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [researchSteps, setResearchSteps] = useState<ResearchStep[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, researchSteps]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: uuidv4(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setResearchSteps([]);

    const assistantMessageId = uuidv4();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isLoading: true,
      sources: [],
    };

    setMessages((prev) => [...prev, assistantMessage]);

    try {
      streamQuery(
        userMessage.content,
        (chunk) => {
          const { event, data, metadata } = chunk;
          const stepName = metadata?.langgraph_node;

          if (stepName) {
            setResearchSteps((prev) => {
              const existingStepIndex = prev.findIndex(
                (s) => s.step === stepName
              );
              if (existingStepIndex > -1) {
                const newSteps = [...prev];
                if (
                  event === "on_tool_end" ||
                  event === "on_chain_end" ||
                  event === "on_chat_model_end"
                ) {
                  newSteps[existingStepIndex].status = "completed";
                }
                return newSteps;
              } else if (
                event === "on_tool_start" ||
                event === "on_chain_start" ||
                event === "on_chat_model_start"
              ) {
                return [
                  ...prev,
                  {
                    step: stepName,
                    details: `Starting ${stepName}...`,
                    status: "loading",
                  },
                ];
              }
              return prev;
            });
          }

          if (event === "on_chat_model_stream") {
            const content = data.chunk.content;
            if (content) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? { ...msg, content: msg.content + content }
                    : msg
                )
              );
            }
          } else if (event === "on_tool_end") {
            if (data.output) {
              try {
                const toolOutput = JSON.parse(data.output);
                if (Array.isArray(toolOutput)) {
                  const newSources: Source[] = toolOutput
                    .map((item: { url?: string; title?: string }) => ({
                      url: item.url,
                      title: item.title,
                    }))
                    .filter((s): s is Source => s.url && s.title);

                  if (newSources.length > 0) {
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? {
                              ...msg,
                              sources: [...(msg.sources || []), ...newSources],
                            }
                          : msg
                      )
                    );
                  }
                }
              } catch {
                // Output is not a JSON array of sources, ignore.
              }
            }
          } else if (event === "on_chat_model_end") {
            setIsLoading(false);
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? {
                      ...msg,
                      content: data.output.content,
                      isLoading: false,
                    }
                  : msg
              )
            );
          } else if (event === "on_chain_end" && data?.output?.final_answer) {
            setIsLoading(false);
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? {
                      ...msg,
                      content: data.output.final_answer,
                      isLoading: false,
                    }
                  : msg
              )
            );
          }
        },
        (error) => {
          console.error("Stream error:", error);
          setIsLoading(false);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content:
                      "An error occurred while generating the response. Please try again.",
                    isLoading: false,
                  }
                : msg
            )
          );
        }
      );
    } catch (error) {
      console.error("Error sending message:", error);
      setIsLoading(false);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content:
                  "An error occurred while sending the message. Please try again.",
                isLoading: false,
              }
            : msg
        )
      );
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full p-4 sm:p-6 lg:p-8">
            <div className="text-center max-w-4xl w-full">
              <div className="w-16 sm:w-20 h-16 sm:h-20 mx-auto mb-6 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-3xl flex items-center justify-center shadow-lg">
                <span className="text-2xl sm:text-3xl">🔬</span>
              </div>
              <h3 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-800 mb-4 px-4">
                Ready to Research Anything
              </h3>
              <p className="text-gray-600 text-sm sm:text-base lg:text-lg leading-relaxed mb-8 px-4 max-w-3xl mx-auto">
                I&apos;m your AI research assistant powered by advanced
                LangGraph workflows. I can help you explore any topic with
                comprehensive analysis, real-time source gathering, and
                intelligent synthesis.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 text-left px-4">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 sm:p-5 hover:shadow-md transition-shadow">
                  <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center mb-3">
                    <span className="text-white text-sm">🔍</span>
                  </div>
                  <h4 className="font-semibold text-gray-800 mb-2 text-sm sm:text-base">
                    Deep Research
                  </h4>
                  <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
                    Multi-source information gathering with intelligent
                    filtering
                  </p>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-xl p-4 sm:p-5 hover:shadow-md transition-shadow">
                  <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center mb-3">
                    <span className="text-white text-sm">🔗</span>
                  </div>
                  <h4 className="font-semibold text-gray-800 mb-2 text-sm sm:text-base">
                    Source Citations
                  </h4>
                  <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
                    Live tracking and verification of information sources
                  </p>
                </div>

                <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 sm:p-5 hover:shadow-md transition-shadow sm:col-span-2 lg:col-span-1">
                  <div className="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center mb-3">
                    <span className="text-white text-sm">🧠</span>
                  </div>
                  <h4 className="font-semibold text-gray-800 mb-2 text-sm sm:text-base">
                    Smart Synthesis
                  </h4>
                  <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
                    Comprehensive analysis with structured insights
                  </p>
                </div>
              </div>

              <div className="mt-6 sm:mt-8 text-xs sm:text-sm text-gray-500 px-4">
                <p>
                  💡 Try asking about current events, technical topics, or any
                  subject you&apos;re curious about!
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <MessageComponent key={message.id} message={message} />
            ))}
            {isLoading && (
              <div className="mt-6">
                <ResearchProgress steps={researchSteps} />
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <div className="border-t border-gray-200/30 bg-gradient-to-r from-white/60 to-white/80 backdrop-blur-md">
        <form onSubmit={handleSubmit} className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-end">
            <div className="flex-1 relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask me anything... Press Enter to send, Shift+Enter for new line"
                disabled={isLoading}
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                className="text-gray-800 w-full px-4 sm:px-5 py-3 sm:py-4 pr-10 sm:pr-12 border-2 border-gray-200 rounded-xl sm:rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-300 shadow-sm transition-all duration-200 bg-white/90 backdrop-blur-sm placeholder-gray-500 resize-none min-h-[3rem] sm:min-h-[3.5rem] max-h-32 overflow-y-auto text-sm sm:text-base"
              ></textarea>
              <div className="absolute right-3 sm:right-4 bottom-3 sm:bottom-4">
                <div className="flex items-center gap-1 sm:gap-2">
                  {input.trim() && (
                    <div className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
                      {input.trim().length}
                    </div>
                  )}
                  <span className="text-gray-400 text-xs sm:text-sm font-medium">
                    ⏎
                  </span>
                </div>
              </div>
            </div>
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-6 sm:px-8 py-3 sm:py-4 rounded-xl sm:rounded-2xl hover:from-blue-600 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-95 min-h-[3rem] sm:min-h-[3.5rem] text-sm sm:text-base"
            >
              {isLoading ? (
                <div className="flex items-center justify-center space-x-2 sm:space-x-3">
                  <div className="w-4 h-4 sm:w-5 sm:h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span className="hidden sm:block">Processing...</span>
                </div>
              ) : (
                <div className="flex items-center justify-center space-x-2 sm:space-x-3">
                  <span className="hidden sm:block">Send</span>
                  <svg
                    className="w-4 h-4 sm:w-5 sm:h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                </div>
              )}
            </button>
          </div>
          <div className="mt-2 sm:mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 text-xs text-gray-500">
            <div className="flex items-center gap-2 sm:gap-4">
              <span className="text-xs">💡 Tip: Be specific for better research results</span>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-medium text-xs">
                AI Powered
              </span>
              <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium text-xs">
                Real-time
              </span>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Chat;

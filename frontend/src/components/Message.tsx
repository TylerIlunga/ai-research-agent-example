import React from "react";
import { Message } from "@/types/chat";
import SourceList from "./SourceList";
import ReactMarkdown from "react-markdown";

interface MessageProps {
  message: Message;
}

const MessageComponent: React.FC<MessageProps> = ({ message }) => {
  return (
    <div
      className={`flex ${
        message.role === "user" ? "justify-end" : "justify-start"
      } mb-8`}
    >
      <div
        className={`max-w-[90%] lg:max-w-[85%] ${
          message.role === "user"
            ? "bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-3xl rounded-br-lg shadow-lg"
            : "bg-white border border-gray-200/80 rounded-3xl rounded-bl-lg shadow-sm hover:shadow-md transition-shadow duration-200"
        } ${message.isLoading ? "opacity-90" : ""}`}
      >
        <div className="p-6">
          <div
            className={`flex items-center gap-3 mb-4 ${
              message.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center text-base font-medium shadow-sm ${
                message.role === "user"
                  ? "bg-white/20 text-white backdrop-blur-sm"
                  : "bg-gradient-to-br from-blue-500 to-indigo-600 text-white"
              }`}
            >
              {message.role === "user" ? "👤" : "🤖"}
            </div>
            <div className="flex flex-col">
              <span
                className={`font-semibold text-sm ${
                  message.role === "user" ? "text-blue-100" : "text-gray-700"
                }`}
              >
                {message.role === "user" ? "You" : "AI Research Assistant"}
              </span>
              <span
                className={`text-xs ${
                  message.role === "user" ? "text-blue-200" : "text-gray-500"
                }`}
              >
                {message.timestamp.toLocaleTimeString()}
              </span>
            </div>
          </div>

          <div
            className={`prose prose-sm max-w-none ${
              message.role === "user" ? "prose-invert" : "prose-gray"
            }`}
          >
            {message.isLoading && message.content === "" ? (
              <div className="flex items-center gap-3 py-3">
                <div className="flex space-x-1">
                  <div
                    className={`w-2 h-2 rounded-full animate-bounce ${
                      message.role === "user" ? "bg-white/60" : "bg-blue-400"
                    }`}
                    style={{ animationDelay: "0s" }}
                  ></div>
                  <div
                    className={`w-2 h-2 rounded-full animate-bounce ${
                      message.role === "user" ? "bg-white/60" : "bg-blue-400"
                    }`}
                    style={{ animationDelay: "0.15s" }}
                  ></div>
                  <div
                    className={`w-2 h-2 rounded-full animate-bounce ${
                      message.role === "user" ? "bg-white/60" : "bg-blue-400"
                    }`}
                    style={{ animationDelay: "0.3s" }}
                  ></div>
                </div>
                <span
                  className={`text-sm italic ${
                    message.role === "user" ? "text-blue-200" : "text-gray-500"
                  }`}
                >
                  Thinking...
                </span>
              </div>
            ) : (
              <div
                className={`${
                  message.role === "user" ? "text-white" : "text-gray-800"
                } leading-relaxed`}
              >
                <ReactMarkdown
                  components={{
                    p: ({ children }) => (
                      <p className="mb-4 last:mb-0 leading-relaxed">
                        {children}
                      </p>
                    ),
                    ul: ({ children }) => (
                      <ul className="list-disc list-inside space-y-2 mb-4 ml-2">
                        {children}
                      </ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="list-decimal list-inside space-y-2 mb-4 ml-2">
                        {children}
                      </ol>
                    ),
                    li: ({ children }) => (
                      <li className="leading-relaxed">{children}</li>
                    ),
                    h1: ({ children }) => (
                      <h1 className="text-xl font-bold mb-3">{children}</h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="text-lg font-semibold mb-3">{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-base font-semibold mb-2">
                        {children}
                      </h3>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-semibold">{children}</strong>
                    ),
                    em: ({ children }) => (
                      <em className="italic">{children}</em>
                    ),
                    code: ({ children }) => (
                      <code
                        className={`px-2 py-1 rounded-md text-sm font-mono ${
                          message.role === "user"
                            ? "bg-white/20 text-blue-100"
                            : "bg-gray-100 text-gray-800 border border-gray-200"
                        }`}
                      >
                        {children}
                      </code>
                    ),
                    pre: ({ children }) => (
                      <pre
                        className={`p-4 rounded-lg text-sm font-mono overflow-x-auto mb-4 ${
                          message.role === "user"
                            ? "bg-white/20 text-blue-100"
                            : "bg-gray-100 text-gray-800 border border-gray-200"
                        }`}
                      >
                        {children}
                      </pre>
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
          </div>

          {message.sources && message.sources.length > 0 && (
            <div className="mt-5 pt-4 border-t border-gray-200/60">
              <SourceList sources={message.sources} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageComponent;

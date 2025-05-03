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
      className={`p-4 rounded-lg ${
        message.role === "user" ? "bg-blue-100 ml-12" : "bg-gray-100 mr-12"
      } ${message.isLoading ? "opacity-70" : ""}`}
    >
      <div className="font-semibold mb-1">
        {message.role === "user" ? "You" : "Research Assistant"}
      </div>

      <div className="prose max-w-none">
        {message.isLoading && message.content === "" ? (
          <div className="flex space-x-2 items-center">
            <div
              className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
              style={{ animationDelay: "0s" }}
            ></div>
            <div
              className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
              style={{ animationDelay: "0.2s" }}
            ></div>
            <div
              className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
              style={{ animationDelay: "0.4s" }}
            ></div>
          </div>
        ) : (
          <ReactMarkdown>{message.content}</ReactMarkdown>
        )}
      </div>

      {message.sources && message.sources.length > 0 && (
        <div className="mt-4">
          <SourceList sources={message.sources} />
        </div>
      )}

      <div className="text-xs text-gray-500 mt-2">
        {message.timestamp.toLocaleString()}
      </div>
    </div>
  );
};

export default MessageComponent;

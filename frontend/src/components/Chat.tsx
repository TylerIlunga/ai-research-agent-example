import React, { useState, useRef, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { Message, Source } from "@/types/chat";
import { sendQuery, streamResponse } from "@/services/api";
import MessageComponent from "./Message";

interface ChatProps {
  conversationId?: string;
}

const Chat: React.FC<ChatProps> = ({ conversationId = "default" }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: uuidv4(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    const loadingMessage: Message = {
      id: uuidv4(),
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isLoading: true,
    };

    // Add user message and loading message
    setMessages((prev) => [...prev, userMessage, loadingMessage]);
    setInput("");
    setIsLoading(true);

    try {
      // Start streaming the response
      let responseContent = "";
      let sources: Source[] = [];

      const stream = streamResponse(userMessage.content, conversationId, {
        onChunk: (chunk) => {
          // Update the content based on the chunk type
          if (chunk.event === "text") {
            responseContent += chunk.data.text;

            setMessages((prev) => {
              const updatedMessages = [...prev];
              const lastMessage = updatedMessages[updatedMessages.length - 1];
              updatedMessages[updatedMessages.length - 1] = {
                ...lastMessage,
                content: responseContent,
                isLoading: true,
              };
              return updatedMessages;
            });
          } else if (chunk.event === "sources") {
            sources = chunk.data.sources;
          }
        },
        onDone: () => {
          // Update the final message with complete content and sources
          setMessages((prev) => {
            const updatedMessages = [...prev];
            const lastMessage = updatedMessages[updatedMessages.length - 1];
            updatedMessages[updatedMessages.length - 1] = {
              ...lastMessage,
              content: responseContent,
              sources,
              isLoading: false,
            };
            console.log("onDone:", updatedMessages);
            return updatedMessages;
          });
          setIsLoading(false);
        },
        onError: (error) => {
          console.error("Stream error:", error);
          setIsLoading(false);

          // Update the loading message to show the error
          setMessages((prev) => {
            const updatedMessages = [...prev];
            const lastMessage = updatedMessages[updatedMessages.length - 1];
            updatedMessages[updatedMessages.length - 1] = {
              ...lastMessage,
              content:
                "An error occurred while generating the response. Please try again.",
              isLoading: false,
            };
            console.log("onError:", updatedMessages);
            return updatedMessages;
          });
        },
      });
    } catch (error) {
      console.error("Error sending message:", error);
      setIsLoading(false);

      // Update the loading message to show the error
      setMessages((prev) => {
        const updatedMessages = [...prev];
        const lastMessage = updatedMessages[updatedMessages.length - 1];
        updatedMessages[updatedMessages.length - 1] = {
          ...lastMessage,
          content:
            "An error occurred while sending the message. Please try again.",
          isLoading: false,
        };
        return updatedMessages;
      });
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <MessageComponent key={message.id} message={message} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="border-t p-4 flex space-x-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask me anything..."
          disabled={isLoading}
          className="flex-1 p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {isLoading ? "Processing..." : "Send"}
        </button>
      </form>
    </div>
  );
};

export default Chat;

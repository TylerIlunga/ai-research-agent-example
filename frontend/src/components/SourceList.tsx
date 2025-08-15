import React from "react";
import { Source } from "@/types/chat";

interface SourceListProps {
  sources: Source[];
}

const SourceList: React.FC<SourceListProps> = ({ sources }) => {
  if (!sources || sources.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <svg
          className="w-4 h-4 text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.102m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
          />
        </svg>
        <h4 className="text-sm font-semibold text-gray-700">Sources</h4>
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
          {sources.length}
        </span>
      </div>
      <div className="grid gap-2">
        {sources.map((source, index) => (
          <a
            key={index}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-3 p-3 bg-gray-50 hover:bg-blue-50 rounded-lg border border-transparent hover:border-blue-200 transition-all duration-200"
          >
            <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0 group-hover:bg-blue-600"></div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800 group-hover:text-blue-800 line-clamp-2 leading-tight">
                {source.title || new URL(source.url).hostname}
              </div>
              <div className="text-xs text-gray-500 mt-1 truncate">
                {source.url}
              </div>
            </div>
            <svg
              className="w-4 h-4 text-gray-400 group-hover:text-blue-500 flex-shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        ))}
      </div>
    </div>
  );
};

export default SourceList;

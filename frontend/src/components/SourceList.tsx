import React from "react";
import { Source } from "@/types/chat";

interface SourceListProps {
  sources: Source[];
}

const SourceList: React.FC<SourceListProps> = ({ sources }) => {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-2">
      <h4 className="text-sm font-medium mb-1">Sources:</h4>
      <ul className="text-sm text-blue-600 space-y-1">
        {sources.map((source, index) => (
          <li key={index}>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {source.title || source.url}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SourceList;

import React from "react";

/**
 * A small inline icon set on a 24px grid. Inline rather than a sprite or a
 * package: there are twelve of them, they inherit `currentColor`, and they
 * replace the emoji that used to carry the interface's visual identity.
 */
export type IconName =
  | "search"
  | "plan"
  | "memory"
  | "write"
  | "check"
  | "alert"
  | "stop"
  | "send"
  | "copy"
  | "download"
  | "plus"
  | "trash"
  | "link"
  | "sun"
  | "moon"
  | "panel"
  | "retry"
  | "chevron";

const PATHS: Record<IconName, React.ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  plan: (
    <>
      <path d="M5 4.5h14" />
      <path d="M5 12h14" />
      <path d="M5 19.5h9" />
      <circle cx="2.6" cy="4.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="2.6" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="2.6" cy="19.5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  memory: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M9 4v16M15 4v16" />
    </>
  ),
  write: (
    <>
      <path d="M4 20h16" />
      <path d="M15.5 4.5a2.1 2.1 0 0 1 3 3L9 17l-4 1 1-4Z" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  alert: (
    <>
      <path d="M12 3.5 22 20H2Z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  send: <path d="M3.5 12 20.5 4l-4 8 4 8Z" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4 19.5h16" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4.5 6.5h15" />
      <path d="M9.5 6.5V4h5v2.5" />
      <path d="M6.5 6.5 7.6 20h8.8l1.1-13.5" />
    </>
  ),
  link: (
    <>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  panel: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  retry: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20.5 4v4.5H16" />
    </>
  ),
  chevron: <path d="m8.5 5 7 7-7 7" />,
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export default function Icon({ name, size = 16, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
